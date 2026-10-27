import { describe, expect, it } from "vitest";
import { LINES, PRODUCTS, buildProfiles } from "../src/catalog.ts";
import { defectLine, inspectionLine } from "../src/load.ts";
import { Rng } from "../src/rng.ts";
import { PlantClock, simulateAll, type SimulationOptions } from "../src/simulate.ts";

const END = Date.parse("2026-10-27T12:00:00Z");
const base: SimulationOptions = { boards: 30_000, days: 14, seed: 7, endMs: END, timeZone: "America/Chicago" };

describe("Rng", () => {
  it("repeats for the same seed and differs for another", () => {
    const a = new Rng(1);
    const b = new Rng(1);
    const c = new Rng(2);
    const xs = Array.from({ length: 5 }, () => a.uint32());
    expect(Array.from({ length: 5 }, () => b.uint32())).toEqual(xs);
    expect(Array.from({ length: 5 }, () => c.uint32())).not.toEqual(xs);
  });

  it("makes version-4 UUIDs", () => {
    const r = new Rng(3);
    for (let i = 0; i < 100; i++) {
      expect(r.uuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });
});

describe("PlantClock", () => {
  it("uses the plant's calendar day, across daylight saving", () => {
    const clock = new PlantClock("America/Chicago");
    // 03:30 UTC on 1 Nov 2026 is still 31 Oct in Chicago (CDT, UTC-5).
    expect(clock.at(Date.parse("2026-11-01T03:30:00Z"))).toEqual({ day: "2026-10-31", hour: 22 });
    // After the switch to CST (UTC-6) on 1 Nov 2026.
    expect(clock.at(Date.parse("2026-11-02T05:30:00Z"))).toEqual({ day: "2026-11-01", hour: 23 });
  });
});

describe("simulate", () => {
  const { boards, stats } = simulateAll(base);

  it("is deterministic for a seed", () => {
    const again = simulateAll(base);
    expect(again.stats).toEqual(stats);
    expect(again.boards[12_345]).toEqual(boards[12_345]);
  });

  it("produces the requested number of boards inside the period, in time order", () => {
    expect(stats.boards).toBe(base.boards);
    const start = END - base.days * 86_400_000;
    let prev = -Infinity;
    for (const { inspection } of boards) {
      expect(inspection.inspectedAt).toBeGreaterThanOrEqual(start);
      expect(inspection.inspectedAt).toBeLessThan(END);
      expect(inspection.inspectedAt).toBeGreaterThanOrEqual(prev);
      prev = inspection.inspectedAt;
    }
  });

  it("only produces rows the database constraints accept", () => {
    const profiles = buildProfiles(base.days);
    const ids = new Set<string>();
    for (const { inspection: i, defects } of boards) {
      ids.add(i.externalId);
      expect(i.cycleMs).toBeGreaterThan(0);
      expect(i.anomalyScore).toBeGreaterThanOrEqual(0);
      expect(i.anomalyScore).toBeLessThanOrEqual(1);
      // review_only_flagged and review_fields_together
      if (i.verdict === "OK") expect(i.reviewOutcome).toBeNull();
      const set = [i.reviewOutcome, i.reviewedBy, i.reviewedAt].filter((v) => v !== null).length;
      expect([0, 3]).toContain(set);
      if (i.reviewedAt !== null) expect(i.reviewedAt).toBeGreaterThan(i.inspectedAt);
      // profile belongs to the board's product and was approved before inspection
      const profile = profiles.find((p) => p.id === i.profileId)!;
      expect(profile.productId).toBe(i.productId);
      // defects only on flagged boards, inside the board outline
      if (i.verdict === "OK") expect(defects).toHaveLength(0);
      else expect(defects.length).toBeGreaterThan(0);
      const product = PRODUCTS.find((p) => p.id === i.productId)!;
      for (const d of defects) {
        expect(d.xMm).toBeGreaterThanOrEqual(0);
        expect(d.yMm).toBeGreaterThanOrEqual(0);
        expect(d.wMm).toBeGreaterThan(0);
        expect(d.hMm).toBeGreaterThan(0);
        expect(d.xMm + d.wMm).toBeLessThanOrEqual(product.widthMm + 0.01);
        expect(d.yMm + d.hMm).toBeLessThanOrEqual(product.heightMm + 0.01);
      }
    }
    expect(ids.size).toBe(boards.length);
  });

  it("keeps cycle times in the 9-14 s range typical of inline AOI", () => {
    const sorted = boards.map((b) => b.inspection.cycleMs).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    expect(median).toBeGreaterThan(9_000);
    expect(median).toBeLessThan(14_000);
  });

  it("gives plausible totals", () => {
    const fpy = stats.ok / stats.boards;
    expect(fpy).toBeGreaterThan(0.9);
    expect(fpy).toBeLessThan(0.98);
    expect(stats.pendingReview).toBeGreaterThan(0);
    expect(stats.confirmedDefects).toBeGreaterThan(0);
    expect(stats.falseCalls).toBeGreaterThan(0);
    expect(new Set(boards.map((b) => b.inspection.lineId))).toEqual(new Set(LINES.map((l) => l.id)));
  });

  it("switches to profile version 2 part-way through", () => {
    const profiles = buildProfiles(base.days);
    const version = (id: number) => profiles.find((p) => p.id === id)!.version;
    expect(version(boards[0].inspection.profileId)).toBe(1);
    expect(version(boards[boards.length - 1].inspection.profileId)).toBe(2);
  });

  it("refuses more boards than the lines can run", () => {
    expect(() => simulateAll({ ...base, boards: 10_000_000, days: 1 })).toThrow(/faster than/);
  });
});

describe("COPY text", () => {
  it("writes NULL as \\N and tab-separated fields", () => {
    const line = inspectionLine({
      id: 1,
      externalId: "00000000-0000-4000-8000-000000000000",
      serialNumber: "PCB-1001-261027-L1-00001",
      productId: 1,
      lineId: 1,
      profileId: 1,
      inspectedAt: Date.parse("2026-10-27T15:00:00Z"),
      localDay: "2026-10-27",
      verdict: "OK",
      anomalyScore: 0.12,
      cycleMs: 11_000,
      reviewOutcome: null,
      reviewedBy: null,
      reviewedAt: null,
    });
    expect(line.split("\t")).toHaveLength(14);
    expect(line.endsWith("\\N\t\\N\t\\N\n")).toBe(true);
    expect(defectLine({ inspectionId: 9, defectClass: "pin_hole", xMm: 1, yMm: 2, wMm: 0.5, hMm: 0.5, confidence: 0.7 })).toBe(
      "9\tpin_hole\t1\t2\t0.5\t0.5\t0.7\n",
    );
  });
});
