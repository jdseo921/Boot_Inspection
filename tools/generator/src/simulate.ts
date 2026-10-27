// Simulates the plant board by board as a generator, so a million-board run
// never holds more than one board in memory.

import {
  DEFECT_CLASSES,
  FALSE_CALL_WEIGHTS,
  LINES,
  PRODUCTS,
  TRUE_DEFECT_WEIGHTS,
  buildExcursions,
  buildProfiles,
  type DefectClass,
  type Excursion,
  type Hotspot,
  type Line,
  type Product,
  type Profile,
} from "./catalog.ts";
import { Rng } from "./rng.ts";

export type Verdict = "OK" | "REVIEW" | "NG";
export type ReviewOutcome = "CONFIRMED_DEFECT" | "FALSE_CALL";

export interface InspectionRow {
  id: number;
  externalId: string;
  serialNumber: string;
  productId: number;
  lineId: number;
  profileId: number;
  inspectedAt: number; // epoch ms
  localDay: string; // YYYY-MM-DD at the plant
  verdict: Verdict;
  anomalyScore: number;
  cycleMs: number;
  reviewOutcome: ReviewOutcome | null;
  reviewedBy: string | null;
  reviewedAt: number | null;
}

export interface DefectRow {
  inspectionId: number;
  defectClass: DefectClass;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  confidence: number;
}

export interface SimulatedBoard {
  inspection: InspectionRow;
  defects: DefectRow[];
}

export interface SimulationOptions {
  seed: number;
  boards: number;
  days: number;
  /** Exclusive end of the period, epoch ms. */
  endMs: number;
  timeZone: string;
}

export interface SimulationStats {
  boards: number;
  ok: number;
  review: number;
  ng: number;
  confirmedDefects: number;
  falseCalls: number;
  pendingReview: number;
  escapes: number;
  defects: number;
  firstDay: string;
  lastDay: string;
}

const DAY_MS = 86_400_000;
const AVG_LOT = 1_450;
const AVG_CHANGEOVER_MS = 32 * 60_000;
const REVIEW_BACKLOG_MS = 36 * 3_600_000;

const REVIEWERS = {
  day: ["op.kim", "op.garcia"],
  swing: ["op.lee", "op.nguyen"],
  night: ["op.patel", "op.choi"],
};

/** Local calendar day and hour at the plant, cached per 15-minute slot. */
export class PlantClock {
  private readonly fmt: Intl.DateTimeFormat;
  private readonly cache = new Map<number, { day: string; hour: number }>();

  constructor(timeZone: string) {
    this.fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
    });
  }

  at(ms: number): { day: string; hour: number } {
    const slot = Math.floor(ms / 900_000);
    let hit = this.cache.get(slot);
    if (!hit) {
      const parts: Record<string, string> = {};
      for (const p of this.fmt.formatToParts(new Date(slot * 900_000))) parts[p.type] = p.value;
      hit = { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
      if (this.cache.size > 50_000) this.cache.clear();
      this.cache.set(slot, hit);
    }
    return hit;
  }
}

interface LineState {
  line: Line;
  t: number;
  produced: number;
  target: number;
  product: Product;
  lotLeft: number;
  seqDay: string;
  seq: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const round4 = (x: number) => Math.round(x * 10_000) / 10_000;

function weightsFor(table: Record<DefectClass, number>, boost?: { cls: DefectClass; factor: number }): number[] {
  return DEFECT_CLASSES.map((c) => table[c] * (boost && boost.cls === c ? boost.factor : 1));
}

/** Runs the whole simulation, collecting every board. Handy for small runs and tests. */
export function simulateAll(opts: SimulationOptions): { boards: SimulatedBoard[]; stats: SimulationStats } {
  const boards: SimulatedBoard[] = [];
  const gen = simulate(opts);
  for (;;) {
    const r = gen.next();
    if (r.done) return { boards, stats: r.value };
    boards.push(r.value);
  }
}

/** Yields boards in time order; returns the totals when the period is filled. */
export function* simulate(opts: SimulationOptions): Generator<SimulatedBoard, SimulationStats, void> {
  if (!Number.isInteger(opts.boards) || opts.boards < 1) throw new Error("boards must be a positive integer");
  if (!Number.isInteger(opts.days) || opts.days < 1) throw new Error("days must be a positive integer");

  const rng = new Rng(opts.seed);
  const idRng = new Rng(opts.seed ^ 0x5eed1d);
  const clock = new PlantClock(opts.timeZone);
  const profiles = buildProfiles(opts.days);
  const excursions = buildExcursions(opts.days);
  const startMs = opts.endMs - opts.days * DAY_MS;
  // Lines stop a little before the end so the last boards are not cut off.
  const stopMs = opts.endMs - 30 * 60_000;
  const usableMs = stopMs - startMs - 20 * 60_000;

  const perLine = Math.ceil(opts.boards / LINES.length);
  const meanCycle = PRODUCTS.reduce((s, p) => s + p.meanCycleMs * p.mix, 0);
  const changeoverMs = (perLine / AVG_LOT) * AVG_CHANGEOVER_MS;
  const spacingMs = (usableMs - changeoverMs) / perLine;
  if (spacingMs < meanCycle * 1.02) {
    const max = Math.floor((LINES.length * (usableMs - changeoverMs)) / (meanCycle * 1.02));
    throw new Error(
      `${opts.boards} boards in ${opts.days} days is faster than ${LINES.length} lines can run; ` +
        `use more days or at most about ${max} boards.`,
    );
  }

  const pickProduct = () => PRODUCTS[rng.weighted(PRODUCTS.map((p) => p.mix))];
  const base = Math.floor(opts.boards / LINES.length);
  const extra = opts.boards % LINES.length;
  const states: LineState[] = LINES.map((line, i) => ({
    line,
    t: startMs + rng.uniform(0, 20 * 60_000),
    produced: 0,
    target: base + (i < extra ? 1 : 0),
    product: pickProduct(),
    lotLeft: rng.int(400, 2_500),
    seqDay: "",
    seq: 0,
  }));

  const stats: SimulationStats = {
    boards: 0,
    ok: 0,
    review: 0,
    ng: 0,
    confirmedDefects: 0,
    falseCalls: 0,
    pendingReview: 0,
    escapes: 0,
    defects: 0,
    firstDay: "",
    lastDay: "",
  };

  const activeProfile = (productId: number, day: number): Profile => {
    let best: Profile | undefined;
    for (const p of profiles) {
      if (p.productId === productId && p.approvedDay <= day && (!best || p.version > best.version)) best = p;
    }
    if (!best) throw new Error(`no profile for product ${productId}`);
    return best;
  };

  const activeExcursion = (line: Line, product: Product, day: number): Excursion | undefined =>
    excursions.find(
      (e) =>
        day >= e.fromDay &&
        day <= e.toDay &&
        e.lineIds.includes(line.id) &&
        (e.productIds === "all" || e.productIds.includes(product.id)),
    );

  const place = (product: Product, spot: Hotspot | null): { x: number; y: number; w: number; h: number } => {
    const w = round2(rng.uniform(0.4, 2.6));
    const h = round2(rng.uniform(0.4, 2.6));
    let cx: number;
    let cy: number;
    if (spot) {
      cx = rng.normal(spot.cx, spot.spread) * product.widthMm;
      cy = rng.normal(spot.cy, spot.spread) * product.heightMm;
    } else {
      cx = rng.uniform(0, product.widthMm);
      cy = rng.uniform(0, product.heightMm);
    }
    cx = Math.min(Math.max(cx, w / 2), product.widthMm - w / 2);
    cy = Math.min(Math.max(cy, h / 2), product.heightMm - h / 2);
    return { x: round2(Math.max(0, cx - w / 2)), y: round2(Math.max(0, cy - h / 2)), w, h };
  };

  let nextId = 1;
  for (;;) {
    // Advance whichever line is furthest behind, so ids follow time order the
    // way they would when stations report in real time.
    let s: LineState | undefined;
    for (const st of states) {
      if (st.produced < st.target && st.t < opts.endMs && (!s || st.t < s.t)) s = st;
    }
    if (!s) break;

    if (s.lotLeft <= 0) {
      // Product changeover: the line stops for a while, then the loop picks
      // whichever line is now furthest behind.
      s.product = pickProduct();
      s.lotLeft = rng.int(400, 2_500);
      s.t += rng.uniform(20, 45) * 60_000;
      continue;
    }

    const product = s.product;
    const t = Math.round(s.t);
    const dayIndex = Math.floor((t - startMs) / DAY_MS);
    const local = clock.at(t);
    const profile = activeProfile(product.id, dayIndex);
    const excursion = activeExcursion(s.line, product, dayIndex);

    let cycleMs = Math.round(rng.normal(product.meanCycleMs, product.meanCycleMs * 0.07));
    cycleMs = Math.max(Math.round(product.meanCycleMs * 0.6), cycleMs);
    if (rng.chance(0.004)) cycleMs += rng.int(5_000, 20_000); // re-scan or conveyor stall

    const night = local.hour >= 22 || local.hour < 6;
    const pDefect =
      product.baseDefectRate * s.line.defectFactor * (night ? 1.12 : 1) * (excursion ? excursion.defectRateFactor : 1);
    const defective = rng.chance(Math.min(pDefect, 0.5));
    const flagged = defective ? rng.chance(profile.detectionRate) : rng.chance(profile.falseCallRate);
    const thr = profile.modelThreshold;

    let score: number;
    if (!flagged) {
      score = defective ? thr - rng.uniform(0.01, 0.1) : (thr - 0.03) * Math.pow(rng.next(), 1.6);
    } else if (defective) {
      score = thr + (1 - thr) * Math.sqrt(rng.next());
    } else {
      score = thr + (1 - thr) * Math.pow(rng.next(), 2.5);
    }
    score = round4(Math.min(1, Math.max(0, score)));
    const verdict: Verdict = !flagged ? "OK" : score >= 0.9 ? "NG" : "REVIEW";

    let reviewOutcome: ReviewOutcome | null = null;
    let reviewedBy: string | null = null;
    let reviewedAt: number | null = null;
    if (flagged) {
      const age = opts.endMs - t;
      const reviewed = age > REVIEW_BACKLOG_MS ? rng.chance(0.995) : rng.chance((age / REVIEW_BACKLOG_MS) * 0.8);
      const delayMs = Math.round(Math.exp(rng.normal(Math.log(25), 0.8)) * 60_000);
      if (reviewed && t + delayMs < opts.endMs - 60_000) {
        reviewOutcome = defective ? "CONFIRMED_DEFECT" : "FALSE_CALL";
        const shift = local.hour >= 6 && local.hour < 14 ? "day" : local.hour >= 14 && local.hour < 22 ? "swing" : "night";
        const team = REVIEWERS[shift];
        reviewedBy = team[rng.int(0, team.length - 1)];
        reviewedAt = t + delayMs;
      }
    }

    if (s.seqDay !== local.day) {
      s.seqDay = local.day;
      s.seq = 0;
    }
    s.seq += 1;
    const yymmdd = local.day.slice(2).replaceAll("-", "");
    const id = nextId++;
    const inspection: InspectionRow = {
      id,
      externalId: idRng.uuid(),
      serialNumber: `${product.partNumber}-${yymmdd}-L${s.line.id}-${String(s.seq).padStart(5, "0")}`,
      productId: product.id,
      lineId: s.line.id,
      profileId: profile.id,
      inspectedAt: t,
      localDay: local.day,
      verdict,
      anomalyScore: score,
      cycleMs,
      reviewOutcome,
      reviewedBy,
      reviewedAt,
    };

    const defects: DefectRow[] = [];
    if (flagged) {
      const boost = excursion ? { cls: excursion.defectClass, factor: excursion.classBoost } : undefined;
      const n = defective ? 1 + rng.weighted([0.62, 0.27, 0.11]) : rng.chance(0.85) ? 1 : 2;
      for (let k = 0; k < n; k++) {
        let cls: DefectClass;
        let spot: Hotspot | null = null;
        if (defective) {
          cls = DEFECT_CLASSES[rng.weighted(weightsFor(TRUE_DEFECT_WEIGHTS, boost))];
          if (excursion && cls === excursion.defectClass) {
            spot = product.hotspots[Math.min(excursion.hotspotIndex, product.hotspots.length - 1)];
          } else if (rng.chance(0.6)) {
            spot = product.hotspots[rng.int(0, product.hotspots.length - 1)];
          }
        } else {
          cls = DEFECT_CLASSES[rng.weighted(weightsFor(FALSE_CALL_WEIGHTS))];
          if (rng.chance(0.35)) spot = product.glareSpots[rng.int(0, product.glareSpots.length - 1)];
        }
        const box = place(product, spot);
        defects.push({
          inspectionId: id,
          defectClass: cls,
          xMm: box.x,
          yMm: box.y,
          wMm: box.w,
          hMm: box.h,
          confidence: round4(defective ? rng.uniform(0.7, 0.99) : rng.uniform(0.45, 0.8)),
        });
        stats.defects += 1;
      }
    }

    stats.boards += 1;
    if (verdict === "OK") stats.ok += 1;
    else if (verdict === "REVIEW") stats.review += 1;
    else stats.ng += 1;
    if (defective && !flagged) stats.escapes += 1;
    if (reviewOutcome === "CONFIRMED_DEFECT") stats.confirmedDefects += 1;
    else if (reviewOutcome === "FALSE_CALL") stats.falseCalls += 1;
    else if (flagged) stats.pendingReview += 1;
    if (!stats.firstDay) stats.firstDay = local.day;
    stats.lastDay = local.day;

    s.produced += 1;
    s.lotLeft -= 1;
    // Pace the line so it finishes its share just before the period ends:
    // spread the time left, minus expected changeovers, over the boards left.
    const left = s.target - s.produced;
    if (left > 0) {
      const budget = stopMs - s.t - (left / AVG_LOT) * AVG_CHANGEOVER_MS;
      const gapMean = Math.max(300, budget / left - product.meanCycleMs);
      s.t += cycleMs + rng.exponential(gapMean);
    }

    yield { inspection, defects };
  }

  return stats;
}
