import type { DefectView } from "../api/types";

interface Props {
  defects: DefectView[];
  selected: number | null;
  onSelect: (index: number) => void;
}

/**
 * AOI-style corner brackets around each flagged region, numbered to match the
 * region table. Regions are often under a millimetre, so the bracket sits a
 * little outside the box and keeps a fixed on-screen stroke.
 */
export function DefectOverlay({ defects, selected, onSelect }: Props) {
  return (
    <g>
      {defects.map((d, i) => {
        const pad = 1.6;
        const x0 = d.xMm - pad;
        const y0 = d.yMm - pad;
        const x1 = d.xMm + d.wMm + pad;
        const y1 = d.yMm + d.hMm + pad;
        const arm = Math.max(1.2, Math.min(x1 - x0, y1 - y0) * 0.35);
        const path = [
          `M${x0},${y0 + arm}V${y0}H${x0 + arm}`,
          `M${x1 - arm},${y0}H${x1}V${y0 + arm}`,
          `M${x1},${y1 - arm}V${y1}H${x1 - arm}`,
          `M${x0 + arm},${y1}H${x0}V${y1 - arm}`,
        ].join("");
        return (
          <g key={d.id} className={selected === i ? "defect is-selected" : "defect"} onClick={() => onSelect(i)}>
            <rect className="defect-hit" x={x0 - 2} y={y0 - 2} width={x1 - x0 + 4} height={y1 - y0 + 4} />
            <rect className="defect-box" x={d.xMm} y={d.yMm} width={d.wMm} height={d.hMm} />
            <path className="defect-bracket" d={path} />
            <text className="defect-num" x={x1 + 0.8} y={y0 - 0.6}>
              {i + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}
