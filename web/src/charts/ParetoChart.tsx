import { useState, type CSSProperties } from "react";
import type { ParetoBar } from "../api/types";

interface Props {
  bars: ParetoBar[];
  className: (c: ParetoBar["defectClass"]) => string;
  formatCount: (n: number) => string;
  formatShare: (x: number) => string;
  cumulativeLabel: string;
}

/**
 * Pareto as sorted horizontal bars on one axis. The running share, usually a
 * second y-axis line, goes in the tooltip and the table view instead, so the
 * chart never needs two scales.
 */
export function ParetoChart({ bars, className, formatCount, formatShare, cumulativeLabel }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...bars.map((b) => b.count));
  return (
    <ul className="pareto" onPointerLeave={() => setActive(null)}>
      {bars.map((b, i) => (
        <li
          key={b.defectClass}
          className={active === i ? "is-active" : undefined}
          tabIndex={0}
          onPointerEnter={() => setActive(i)}
          onFocus={() => setActive(i)}
          onBlur={() => setActive(null)}
          aria-label={`${className(b.defectClass)}: ${formatCount(b.count)}, ${formatShare(b.share)}`}
        >
          <span className="pareto-label">{className(b.defectClass)}</span>
          <span className="pareto-track">
            <span className="pareto-bar" style={{ "--w": b.count / max } as CSSProperties} />
            <span className="pareto-value">
              {formatCount(b.count)} <span className="muted">({formatShare(b.share)})</span>
            </span>
          </span>
          {active === i && (
            <span className="tooltip tooltip-inline" role="status">
              <strong>{formatShare(b.cumulativeShare)}</strong>
              <span>{cumulativeLabel}</span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
