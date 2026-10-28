// Ingest request bodies built from the same simulation the generator loads,
// so the load test posts realistic boards: the real verdict mix, one or two
// defect boxes on flagged boards, real line codes and profile versions.

import { LINES, PRODUCTS, buildProfiles, type Profile } from "../../generator/src/catalog.ts";
import { simulate, type SimulatedBoard } from "../../generator/src/simulate.ts";

export interface InspectionIn {
  externalId: string;
  serialNumber: string;
  lineCode: string;
  partNumber: string;
  profileVersion: number;
  inspectedAt: string;
  verdict: "OK" | "REVIEW" | "NG";
  anomalyScore: number;
  cycleMs: number;
  defects: {
    defectClass: string;
    xMm: number;
    yMm: number;
    wMm: number;
    hMm: number;
    confidence: number;
  }[];
}

const DAYS = 90;
const BOARDS_PER_ROUND = 1_200_000;

export function toInspectionIn(b: SimulatedBoard, profiles: readonly Profile[]): InspectionIn {
  const r = b.inspection;
  const line = LINES.find((l) => l.id === r.lineId);
  const product = PRODUCTS.find((p) => p.id === r.productId);
  const profile = profiles.find((p) => p.id === r.profileId);
  if (!line || !product || !profile) throw new Error(`board ${r.externalId} refers to an unknown catalog entry`);
  return {
    externalId: r.externalId,
    serialNumber: r.serialNumber,
    lineCode: line.code,
    partNumber: product.partNumber,
    profileVersion: profile.version,
    inspectedAt: new Date(r.inspectedAt).toISOString(),
    verdict: r.verdict,
    anomalyScore: r.anomalyScore,
    cycleMs: r.cycleMs,
    defects: b.defects.map((d) => ({
      defectClass: d.defectClass,
      xMm: d.xMm,
      yMm: d.yMm,
      wMm: d.wMm,
      hMm: d.hMm,
      confidence: d.confidence,
    })),
  };
}

/**
 * An endless stream of new boards. Each round of 1.2 million uses its own
 * seed, so external ids never repeat within a run, and a run seeded
 * differently from the loaded data never collides with it.
 */
export class BoardSource {
  private seed: number;
  private gen: Generator<SimulatedBoard, unknown, void>;
  private readonly profiles = buildProfiles(DAYS);

  constructor(
    seed: number,
    private readonly endMs: number,
    private readonly timeZone: string,
  ) {
    this.seed = seed;
    this.gen = this.round();
  }

  private round(): Generator<SimulatedBoard, unknown, void> {
    return simulate({ seed: this.seed, boards: BOARDS_PER_ROUND, days: DAYS, endMs: this.endMs, timeZone: this.timeZone });
  }

  next(): InspectionIn {
    let r = this.gen.next();
    if (r.done) {
      this.seed += 1;
      this.gen = this.round();
      r = this.gen.next();
    }
    return toInspectionIn(r.value as SimulatedBoard, this.profiles);
  }

  take(n: number): InspectionIn[] {
    const out: InspectionIn[] = [];
    for (let i = 0; i < n; i++) out.push(this.next());
    return out;
  }
}
