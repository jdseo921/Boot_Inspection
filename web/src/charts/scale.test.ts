import { describe, expect, it } from "vitest";
import { linear, niceTicks } from "./scale";

describe("niceTicks", () => {
  it("covers the range with round steps", () => {
    expect(niceTicks(0.913, 0.968)).toEqual([0.9, 0.92, 0.94, 0.96, 0.98]);
    expect(niceTicks(0, 980)).toEqual([0, 250, 500, 750, 1000]);
  });

  it("widens a flat range instead of dividing by zero", () => {
    const t = niceTicks(5, 5);
    expect(t[0]).toBeLessThan(5);
    expect(t[t.length - 1]).toBeGreaterThan(5);
  });
});

describe("linear", () => {
  it("maps domain to range, including inverted ranges", () => {
    const y = linear([0, 1], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(0.25)).toBe(150);
    expect(y(1)).toBe(0);
  });
});
