import { useState } from "react";
import type { Heatmap } from "../api/types";
import { Board } from "../components/Board";

interface Props {
  heatmap: Heatmap;
  label: string;
  scaleLabel: string;
  formatCount: (n: number) => string;
  describeCell: (x0: number, x1: number, y0: number, y1: number) => string;
}

/**
 * Flagged regions binned onto a grid over the board outline. One hue (orange
 * against the green mask), opacity rising with the count; the legend states
 * the scale and the table view lists the busiest cells.
 */
export function BoardHeatmap({ heatmap: h, label, scaleLabel, formatCount, describeCell }: Props) {
  const [active, setActive] = useState<{ cx: number; cy: number; count: number } | null>(null);
  const cw = h.boardWidthMm / h.cols;
  const ch = h.boardHeightMm / h.rows;
  const alpha = (n: number) => (h.max === 0 ? 0 : 0.04 + 0.91 * (n / h.max));
  const r1 = (v: number) => Math.round(v * 10) / 10;

  return (
    <div className="heatmap" onPointerLeave={() => setActive(null)}>
      <Board widthMm={h.boardWidthMm} heightMm={h.boardHeightMm} partNumber={h.partNumber} label={label}>
        {h.cells.map((c) => (
          <rect
            key={`${c.cx}-${c.cy}`}
            className={active && active.cx === c.cx && active.cy === c.cy ? "heat-cell is-active" : "heat-cell"}
            x={c.cx * cw + 0.1}
            y={c.cy * ch + 0.1}
            width={cw - 0.2}
            height={ch - 0.2}
            rx={0.4}
            style={{ fill: `rgba(var(--heat), ${alpha(c.count).toFixed(3)})` }}
            onPointerEnter={() => setActive(c)}
          />
        ))}
      </Board>
      <div className="heat-legend" aria-hidden="true">
        <span>0</span>
        <span className="heat-ramp" />
        <span>{formatCount(h.max)}</span>
        <span className="muted">{scaleLabel}</span>
      </div>
      {active && (
        <div className="tooltip heat-tip" role="status">
          <strong>{formatCount(active.count)}</strong>
          <span>
            {describeCell(r1(active.cx * cw), r1((active.cx + 1) * cw), r1(active.cy * ch), r1((active.cy + 1) * ch))}
          </span>
        </div>
      )}
    </div>
  );
}
