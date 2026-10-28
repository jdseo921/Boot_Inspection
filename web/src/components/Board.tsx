import type { ReactNode } from "react";

interface Props {
  widthMm: number;
  heightMm: number;
  partNumber: string;
  label: string;
  children?: ReactNode;
}

/**
 * A bare board drawn to scale in millimetres: solder mask, silkscreen
 * outline, mounting holes, fiducials. Overlays (heat cells, defect boxes)
 * are drawn as children in the same millimetre coordinates.
 */
export function Board({ widthMm: W, heightMm: H, partNumber, label, children }: Props) {
  const holes = [
    [4, 4],
    [W - 4, 4],
    [4, H - 4],
    [W - 4, H - 4],
  ];
  const text = Math.max(2.4, Math.min(W, H) * 0.045);
  return (
    <svg className="board" viewBox={`-2 -2 ${W + 4} ${H + 4}`} role="img" aria-label={label}>
      <rect className="board-mask" x={0} y={0} width={W} height={H} rx={2} />
      <rect className="board-silk" x={3} y={3} width={W - 6} height={H - 6} rx={1} />
      {holes.map(([cx, cy]) => (
        <g key={`${cx}-${cy}`}>
          <circle className="board-pad" cx={cx} cy={cy} r={2.2} />
          <circle className="board-hole" cx={cx} cy={cy} r={1.2} />
        </g>
      ))}
      <circle className="board-pad" cx={10} cy={4.5} r={0.8} />
      <circle className="board-pad" cx={W - 10} cy={H - 4.5} r={0.8} />
      <text className="board-text" x={8} y={H - 7} fontSize={text}>
        {partNumber}
      </text>
      {children}
    </svg>
  );
}
