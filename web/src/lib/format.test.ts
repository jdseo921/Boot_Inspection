import { describe, expect, it } from "vitest";
import { addDays, count, percent, seconds, shortDay } from "./format";

describe("format", () => {
  it("formats rates and counts per locale", () => {
    expect(percent(0.94451, "en-US")).toBe("94.5%");
    expect(percent(0.5714, "ko-KR", 2)).toBe("57.14%");
    expect(count(396113, "en-US")).toBe("396,113");
    expect(percent(null, "en-US")).toBe("–");
  });

  it("shows cycle times in seconds", () => {
    expect(seconds(10602, "en-US")).toBe("10.6 s");
  });

  it("does date arithmetic on plant days without time zones", () => {
    expect(addDays("2026-10-27", -29)).toBe("2026-09-28");
    expect(addDays("2026-03-08", 1)).toBe("2026-03-09"); // US DST change
    expect(shortDay("2026-10-20", "en-US")).toBe("Oct 20");
    expect(shortDay("2026-10-20", "ko-KR")).toBe("10월 20일");
  });
});
