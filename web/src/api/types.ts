// Mirrors the API's JSON (see docs/openapi.yaml).

export type Verdict = "OK" | "REVIEW" | "NG";
export type ReviewOutcome = "CONFIRMED_DEFECT" | "FALSE_CALL";
export const DEFECT_CLASSES = ["open", "short", "mousebite", "spur", "copper", "pin_hole"] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

export interface Meta {
  timezone: string;
  today: string;
  defaultDays: number;
  maxDays: number;
}

export interface Line {
  id: number;
  code: string;
  name: string;
  site: string;
}

export interface Product {
  id: number;
  partNumber: string;
  name: string;
  boardWidthMm: number;
  boardHeightMm: number;
}

export interface Profile {
  id: number;
  productId: number;
  version: number;
  pixelDiff: number;
  minDefectAreaPx: number;
  modelThreshold: number;
  approvedBy: string;
  approvedAt: string;
}

export interface InspectionView {
  id: number;
  externalId: string;
  serialNumber: string;
  lineId: number;
  lineCode: string;
  productId: number;
  partNumber: string;
  profileVersion: number;
  inspectedAt: string;
  localDay: string;
  verdict: Verdict;
  anomalyScore: number;
  cycleMs: number;
  reviewOutcome: ReviewOutcome | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  defectCount: number;
}

export interface DefectView {
  id: number;
  defectClass: DefectClass;
  xMm: number;
  yMm: number;
  wMm: number;
  hMm: number;
  confidence: number;
}

export interface InspectionDetail {
  inspection: InspectionView;
  product: Product;
  line: Line;
  profile: Profile;
  defects: DefectView[];
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Summary {
  from: string;
  to: string;
  inspected: number;
  ok: number;
  review: number;
  ng: number;
  confirmedDefects: number;
  falseCalls: number;
  pendingReview: number;
  firstPassYield: number | null;
  finalYield: number | null;
  falseCallRate: number | null;
  meanCycleMs: number | null;
  p50CycleMs: number | null;
  p95CycleMs: number | null;
}

export interface TrendPoint {
  day: string;
  inspected: number;
  ok: number;
  review: number;
  ng: number;
  confirmedDefects: number;
  falseCalls: number;
  firstPassYield: number | null;
  falseCallRate: number | null;
}

export interface ParetoBar {
  defectClass: DefectClass;
  count: number;
  share: number;
  cumulativeShare: number;
}

export interface HeatCell {
  cx: number;
  cy: number;
  count: number;
}

export interface Heatmap {
  productId: number;
  partNumber: string;
  boardWidthMm: number;
  boardHeightMm: number;
  cols: number;
  rows: number;
  total: number;
  max: number;
  cells: HeatCell[];
}
