// The fictional plant the generator simulates: three SMT lines, four board
// types, and two approved threshold profiles per board type.
//
// Everything below is invented for the demo. The defect classes are the six
// used by the public DeepPCB benchmark.

export const DEFECT_CLASSES = ["open", "short", "mousebite", "spur", "copper", "pin_hole"] as const;
export type DefectClass = (typeof DEFECT_CLASSES)[number];

export interface Line {
  id: number;
  code: string;
  name: string;
  site: string;
  /** Multiplier on the board-level defect rate. */
  defectFactor: number;
}

/** A spot where defects cluster, as fractions of board width and height. */
export interface Hotspot {
  label: string;
  cx: number;
  cy: number;
  spread: number;
}

export interface Product {
  id: number;
  partNumber: string;
  name: string;
  widthMm: number;
  heightMm: number;
  /** Share of boards that come off the line with at least one real defect. */
  baseDefectRate: number;
  meanCycleMs: number;
  /** Where real defects cluster (fine-pitch parts, connectors, vias). */
  hotspots: Hotspot[];
  /** Where false calls cluster (glare near fiducials, silkscreen edges). */
  glareSpots: Hotspot[];
  /** Share of production volume. */
  mix: number;
}

export interface Profile {
  id: number;
  productId: number;
  version: number;
  pixelDiff: number;
  minDefectAreaPx: number;
  modelThreshold: number;
  approvedBy: string;
  /** Days after the start of the generated period; may be negative. */
  approvedDay: number;
  /** Simulation only: chance a good board is flagged (a false call). */
  falseCallRate: number;
  /** Simulation only: chance a defective board is flagged. */
  detectionRate: number;
}

export const LINES: Line[] = [
  { id: 1, code: "SMT-1", name: "SMT Line 1", site: "Plant 1", defectFactor: 1.0 },
  { id: 2, code: "SMT-2", name: "SMT Line 2", site: "Plant 1", defectFactor: 1.15 },
  { id: 3, code: "SMT-3", name: "SMT Line 3", site: "Plant 1", defectFactor: 0.85 },
];

export const PRODUCTS: Product[] = [
  {
    id: 1,
    partNumber: "PCB-1001",
    name: "Motor controller",
    widthMm: 160,
    heightMm: 100,
    baseDefectRate: 0.022,
    meanCycleMs: 11_800,
    mix: 0.34,
    hotspots: [
      { label: "MCU QFP-100", cx: 0.42, cy: 0.38, spread: 0.05 },
      { label: "Gate driver", cx: 0.72, cy: 0.62, spread: 0.06 },
      { label: "Power connector", cx: 0.08, cy: 0.5, spread: 0.04 },
    ],
    glareSpots: [{ label: "Fiducial", cx: 0.04, cy: 0.06, spread: 0.03 }],
  },
  {
    id: 2,
    partNumber: "PCB-2040",
    name: "Battery monitor",
    widthMm: 120,
    heightMm: 80,
    baseDefectRate: 0.016,
    meanCycleMs: 9_600,
    mix: 0.28,
    hotspots: [
      { label: "AFE QFN-48", cx: 0.55, cy: 0.45, spread: 0.05 },
      { label: "Cell tap header", cx: 0.9, cy: 0.5, spread: 0.04 },
    ],
    glareSpots: [{ label: "Fiducial", cx: 0.95, cy: 0.92, spread: 0.03 }],
  },
  {
    id: 3,
    partNumber: "PCB-3310",
    name: "LED driver",
    widthMm: 90,
    heightMm: 60,
    baseDefectRate: 0.011,
    meanCycleMs: 9_100,
    mix: 0.22,
    hotspots: [
      { label: "Driver IC", cx: 0.35, cy: 0.5, spread: 0.06 },
      { label: "Inductor pads", cx: 0.7, cy: 0.3, spread: 0.05 },
    ],
    glareSpots: [{ label: "Silkscreen logo", cx: 0.8, cy: 0.85, spread: 0.04 }],
  },
  {
    id: 4,
    partNumber: "PCB-4502",
    name: "Power module",
    widthMm: 200,
    heightMm: 150,
    baseDefectRate: 0.03,
    meanCycleMs: 13_900,
    mix: 0.16,
    hotspots: [
      { label: "MOSFET bridge", cx: 0.3, cy: 0.3, spread: 0.07 },
      { label: "Current shunt", cx: 0.62, cy: 0.7, spread: 0.05 },
      { label: "Thermal vias", cx: 0.5, cy: 0.5, spread: 0.08 },
    ],
    glareSpots: [{ label: "Heatsink edge", cx: 0.5, cy: 0.04, spread: 0.05 }],
  },
];

/**
 * Version 1 of every profile is in force when the period starts; version 2
 * (stricter model threshold, fewer false calls, slightly lower detection) is
 * approved part-way through so the dashboard shows the change.
 */
export function buildProfiles(days: number): Profile[] {
  const switchDay = Math.floor(days / 2);
  const profiles: Profile[] = [];
  let id = 1;
  for (const p of PRODUCTS) {
    profiles.push({
      id: id++,
      productId: p.id,
      version: 1,
      pixelDiff: 28,
      minDefectAreaPx: 12,
      modelThreshold: 0.62,
      approvedBy: "process.eng.park",
      approvedDay: -30,
      falseCallRate: 0.045,
      detectionRate: 0.985,
    });
    profiles.push({
      id: id++,
      productId: p.id,
      version: 2,
      pixelDiff: 32,
      minDefectAreaPx: 16,
      modelThreshold: 0.68,
      approvedBy: "process.eng.park",
      approvedDay: switchDay + (p.id - 1),
      falseCallRate: 0.026,
      detectionRate: 0.978,
    });
  }
  return profiles;
}

/** Relative frequency of each class among real defects. */
export const TRUE_DEFECT_WEIGHTS: Record<DefectClass, number> = {
  open: 0.22,
  short: 0.18,
  mousebite: 0.17,
  spur: 0.16,
  copper: 0.12,
  pin_hole: 0.15,
};

/** What the machine thinks it saw when it flags a good board. */
export const FALSE_CALL_WEIGHTS: Record<DefectClass, number> = {
  open: 0.08,
  short: 0.07,
  mousebite: 0.12,
  spur: 0.25,
  copper: 0.26,
  pin_hole: 0.22,
};

/** A process excursion: for a while, one class of defect jumps on a line. */
export interface Excursion {
  label: string;
  lineIds: number[];
  productIds: number[] | "all";
  fromDay: number;
  toDay: number;
  defectRateFactor: number;
  defectClass: DefectClass;
  classBoost: number;
  /** Index into the product's hotspots where the boosted class lands. */
  hotspotIndex: number;
}

export function buildExcursions(days: number): Excursion[] {
  const d = (fraction: number) => Math.floor(days * fraction);
  return [
    {
      label: "Stencil misalignment on SMT-2: solder bridges on fine-pitch parts",
      lineIds: [2],
      productIds: "all",
      fromDay: d(0.58),
      toDay: d(0.58) + 6,
      defectRateFactor: 2.4,
      defectClass: "short",
      classBoost: 6,
      hotspotIndex: 0,
    },
    {
      label: "Bad copper-plating lot on power modules: opens",
      lineIds: [1, 2, 3],
      productIds: [4],
      fromDay: d(0.22),
      toDay: d(0.22) + 4,
      defectRateFactor: 1.9,
      defectClass: "open",
      classBoost: 4,
      hotspotIndex: 2,
    },
  ];
}
