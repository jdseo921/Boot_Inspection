import type {
  Heatmap,
  InspectionDetail,
  InspectionView,
  Line,
  Meta,
  ParetoBar,
  Product,
  Summary,
  TrendPoint,
} from "../api/types";

export const meta: Meta = { timezone: "America/Chicago", today: "2026-10-27", defaultDays: 30, maxDays: 366 };

export const lines: Line[] = [
  { id: 1, code: "SMT-1", name: "SMT Line 1", site: "Plant 1" },
  { id: 2, code: "SMT-2", name: "SMT Line 2", site: "Plant 1" },
];

export const products: Product[] = [
  { id: 1, partNumber: "PCB-1001", name: "Motor controller", boardWidthMm: 160, boardHeightMm: 100 },
  { id: 2, partNumber: "PCB-2040", name: "Battery monitor", boardWidthMm: 120, boardHeightMm: 80 },
];

export const summary: Summary = {
  from: "2026-09-28",
  to: "2026-10-27",
  inspected: 396113,
  ok: 374131,
  review: 15000,
  ng: 6982,
  confirmedDefects: 9000,
  falseCalls: 12000,
  pendingReview: 982,
  firstPassYield: 0.94451,
  finalYield: 0.97612,
  falseCallRate: 0.5714,
  meanCycleMs: 11009,
  p50CycleMs: 10602,
  p95CycleMs: 14499,
};

export const trend: TrendPoint[] = ["2026-10-25", "2026-10-26", "2026-10-27"].map((day, i) => ({
  day,
  inspected: 13000 + i,
  ok: 12300,
  review: 500,
  ng: 200,
  confirmedDefects: 300,
  falseCalls: 400,
  firstPassYield: [0.945, 0.951, 0.948][i],
  falseCallRate: [0.6, 0.55, 0.57][i],
}));

export const pareto: ParetoBar[] = [
  { defectClass: "spur", count: 500, share: 0.5, cumulativeShare: 0.5 },
  { defectClass: "short", count: 300, share: 0.3, cumulativeShare: 0.8 },
  { defectClass: "open", count: 200, share: 0.2, cumulativeShare: 1 },
];

export const heatmap: Heatmap = {
  productId: 1,
  partNumber: "PCB-1001",
  boardWidthMm: 160,
  boardHeightMm: 100,
  cols: 24,
  rows: 16,
  total: 12,
  max: 9,
  cells: [
    { cx: 0, cy: 0, count: 9 },
    { cx: 12, cy: 8, count: 3 },
  ],
};

export function view(id: number, overrides: Partial<InspectionView> = {}): InspectionView {
  return {
    id,
    externalId: `00000000-0000-4000-8000-${String(id).padStart(12, "0")}`,
    serialNumber: `PCB-1001-261027-L1-${String(id).padStart(5, "0")}`,
    lineId: 1,
    lineCode: "SMT-1",
    productId: 1,
    partNumber: "PCB-1001",
    profileVersion: 2,
    inspectedAt: `2026-10-27T1${id % 10}:00:00Z`,
    localDay: "2026-10-27",
    verdict: "REVIEW",
    anomalyScore: 0.81,
    cycleMs: 11200,
    reviewOutcome: null,
    reviewedBy: null,
    reviewedAt: null,
    defectCount: 1,
    ...overrides,
  };
}

export function detail(v: InspectionView): InspectionDetail {
  return {
    inspection: v,
    product: products[0],
    line: lines[0],
    profile: {
      id: 2,
      productId: 1,
      version: 2,
      pixelDiff: 32,
      minDefectAreaPx: 16,
      modelThreshold: 0.68,
      approvedBy: "process.eng.park",
      approvedAt: "2026-09-12T00:00:00Z",
    },
    defects: [{ id: v.id * 10, defectClass: "short", xMm: 64.2, yMm: 37.5, wMm: 1.2, hMm: 0.8, confidence: 0.93 }],
  };
}
