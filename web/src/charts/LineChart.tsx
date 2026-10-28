import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { linear, niceTicks } from "./scale";
import { useWidth } from "./useWidth";

export interface LinePoint {
  /** Category on the x axis (a plant day). */
  x: string;
  y: number | null;
  /** Extra line in the tooltip, e.g. how many boards the point stands for. */
  note?: string;
}

interface Props {
  points: LinePoint[];
  label: string;
  formatY: (v: number) => string;
  formatX: (x: string) => string;
  /** Clamp for the y axis, e.g. [0, 1] for rates. */
  bounds?: [number, number];
  height?: number;
}

const M = { top: 12, right: 56, bottom: 28, left: 52 };

/**
 * One series over plant days: 2px line, crosshair that snaps to the nearest
 * day, the same readout on keyboard focus (arrow keys), the latest value
 * labelled at the line's end. Gaps (days without boards) break the line.
 */
export function LineChart({ points, label, formatY, formatX, bounds = [0, 1], height = 200 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const descId = useId();

  const values = points.map((p) => p.y).filter((v): v is number => v !== null);
  const plotW = Math.max(120, width - M.left - M.right);
  const plotH = height - M.top - M.bottom;

  let lo = values.length ? Math.min(...values) : bounds[0];
  let hi = values.length ? Math.max(...values) : bounds[1];
  const pad = (hi - lo) * 0.15 || 0.01;
  lo = Math.max(bounds[0], lo - pad);
  hi = Math.min(bounds[1], hi + pad);
  const ticks = niceTicks(lo, hi, 4).filter((t) => t >= bounds[0] - 1e-9 && t <= bounds[1] + 1e-9);
  const y0 = ticks.length ? Math.min(ticks[0], lo) : lo;
  const y1 = ticks.length ? Math.max(ticks[ticks.length - 1], hi) : hi;

  const x = (i: number) => M.left + (points.length <= 1 ? plotW / 2 : (i / (points.length - 1)) * plotW);
  const y = linear([y0, y1], [M.top + plotH, M.top]);

  // Path with breaks at nulls.
  let d = "";
  let pen = false;
  points.forEach((p, i) => {
    if (p.y === null) {
      pen = false;
      return;
    }
    d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`;
    pen = true;
  });

  const lastIndex = (() => {
    for (let i = points.length - 1; i >= 0; i--) if (points[i].y !== null) return i;
    return -1;
  })();

  // About six x labels whatever the width.
  const every = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(plotW / 90))));

  const nearest = (clientX: number, rect: DOMRect) => {
    if (points.length === 0) return null;
    const px = clientX - rect.left - M.left;
    const i = points.length <= 1 ? 0 : Math.round((px / plotW) * (points.length - 1));
    return Math.max(0, Math.min(points.length - 1, i));
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) =>
    setActive(nearest(e.clientX, e.currentTarget.getBoundingClientRect()));
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const step = e.key === "ArrowRight" ? 1 : -1;
      setActive((a) => Math.max(0, Math.min(points.length - 1, (a ?? lastIndex) + step)));
    } else if (e.key === "Escape") {
      setActive(null);
    }
  };

  const tip = active !== null ? points[active] : null;
  const tipLeft = active !== null ? Math.min(Math.max(x(active), 70), width - 70) : 0;

  return (
    <div ref={ref} className="chart">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={label}
        aria-describedby={descId}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive((a) => a ?? (lastIndex >= 0 ? lastIndex : null))}
        onBlur={() => setActive(null)}
        onKeyDown={onKey}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.left} x2={M.left + plotW} y1={y(t)} y2={y(t)} />
            <text className="tick" x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end">
              {formatY(t)}
            </text>
          </g>
        ))}
        <line className="axis" x1={M.left} x2={M.left + plotW} y1={M.top + plotH} y2={M.top + plotH} />
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={p.x} className="tick" x={x(i)} y={height - 8} textAnchor="middle">
              {formatX(p.x)}
            </text>
          ) : null,
        )}
        {active !== null && <line className="crosshair" x1={x(active)} x2={x(active)} y1={M.top} y2={M.top + plotH} />}
        <path className="line" d={d} />
        {lastIndex >= 0 && (
          <g>
            <circle className="dot" cx={x(lastIndex)} cy={y(points[lastIndex].y!)} r={4} />
            <text className="end-label" x={x(lastIndex) + 8} y={y(points[lastIndex].y!)} dy="0.32em">
              {formatY(points[lastIndex].y!)}
            </text>
          </g>
        )}
        {tip && tip.y !== null && <circle className="dot" cx={x(active!)} cy={y(tip.y)} r={4} />}
      </svg>
      <p id={descId} className="sr-only">
        {lastIndex >= 0 ? `${formatX(points[lastIndex].x)}: ${formatY(points[lastIndex].y!)}` : ""}
      </p>
      {tip && (
        <div className="tooltip" style={{ left: tipLeft, top: 0 }} role="status">
          <strong>{tip.y === null ? "–" : formatY(tip.y)}</strong>
          <span>{formatX(tip.x)}</span>
          {tip.note && <span>{tip.note}</span>}
        </div>
      )}
    </div>
  );
}
