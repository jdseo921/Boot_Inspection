import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LineChart } from "./LineChart";

const points = [
  { x: "2026-10-25", y: 0.945 },
  { x: "2026-10-26", y: null },
  { x: "2026-10-27", y: 0.951 },
];
const fmt = (v: number) => `${(v * 100).toFixed(1)}%`;

describe("LineChart", () => {
  it("labels the latest value and breaks the line where a day has no data", () => {
    const { container } = render(<LineChart points={points} label="FPY" formatY={fmt} formatX={(d) => d.slice(5)} />);
    expect(screen.getByText("95.1%")).toBeInTheDocument();
    const d = container.querySelector("path.line")!.getAttribute("d")!;
    expect(d.match(/M/g)).toHaveLength(2);
  });

  it("gives keyboard users the same readout as hover", () => {
    render(<LineChart points={points} label="FPY" formatY={fmt} formatX={(d) => d.slice(5)} />);
    const chart = screen.getByRole("img", { name: "FPY" });
    fireEvent.focus(chart);
    expect(screen.getByRole("status")).toHaveTextContent("10-27");
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(screen.getByRole("status")).toHaveTextContent("94.5%");
    expect(screen.getByRole("status")).toHaveTextContent("10-25");
  });
});
