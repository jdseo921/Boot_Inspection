import { describe, expect, it } from "vitest";
import { BoardSource } from "../src/boards.ts";
import { table } from "../src/report.ts";
import { ms, percentile, summarize, times } from "../src/stats.ts";

describe("percentile (nearest rank)", () => {
  const sorted = Array.from({ length: 20 }, (_, i) => i + 1); // 1..20

  it("picks real samples, never interpolates", () => {
    expect(percentile(sorted, 50)).toBe(10);
    expect(percentile(sorted, 95)).toBe(19);
    expect(percentile(sorted, 99)).toBe(20);
  });

  it("handles the edges and refuses no samples", () => {
    expect(percentile(sorted, 0)).toBe(1);
    expect(percentile(sorted, 100)).toBe(20);
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 50)).toThrow();
  });

  it("summarize sorts a copy", () => {
    const samples = [5, 1, 4, 2, 3];
    const s = summarize(samples);
    expect(s).toMatchObject({ n: 5, min: 1, p50: 3, max: 5, mean: 3 });
    expect(samples).toEqual([5, 1, 4, 2, 3]);
  });
});

describe("formatting", () => {
  it("formats milliseconds by size", () => {
    expect(ms(0.4219)).toBe("0.42 ms");
    expect(ms(3.14)).toBe("3.1 ms");
    expect(ms(1234.4)).toBe("1,234 ms");
  });

  it("formats speed-ups", () => {
    expect(times(526, 11)).toBe("48x");
    expect(times(5, 2)).toBe("2.5x");
  });

  it("builds an aligned markdown table", () => {
    expect(table(["a", "b"], [["x", "1"]], ["l", "r"])).toBe("| a | b |\n| --- | ---: |\n| x | 1 |");
  });
});

describe("BoardSource", () => {
  const end = Date.parse("2026-10-28T00:00:00Z");

  it("produces valid ingest bodies", () => {
    const boards = new BoardSource(7, end, "America/Chicago").take(5_000);
    for (const b of boards) {
      expect(["SMT-1", "SMT-2", "SMT-3"]).toContain(b.lineCode);
      expect([1, 2]).toContain(b.profileVersion);
      expect(b.cycleMs).toBeGreaterThan(0);
      expect(b.anomalyScore).toBeGreaterThanOrEqual(0);
      expect(b.anomalyScore).toBeLessThanOrEqual(1);
      expect(Date.parse(b.inspectedAt)).toBeLessThan(end);
      // The API rejects OK boards with boxes and flagged boards without.
      expect(b.defects.length === 0).toBe(b.verdict === "OK");
    }
    expect(new Set(boards.map((b) => b.verdict))).toEqual(new Set(["OK", "REVIEW", "NG"]));
  });

  it("never repeats an external id, and differs from the loaded data's seed", () => {
    const a = new BoardSource(7, end, "America/Chicago").take(20_000);
    const loaded = new BoardSource(42, end, "America/Chicago").take(20_000);
    const ids = new Set(a.map((b) => b.externalId));
    expect(ids.size).toBe(a.length);
    expect(loaded.some((b) => ids.has(b.externalId))).toBe(false);
  });
});
