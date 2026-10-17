/**
 * Decorative geometry for the schematic York University map (viewBox 1000×640).
 * Purely visual — routing uses MAP_NODES / WALKWAYS in src/lib/campus.ts.
 */
import type { LocationId } from "@/lib/campus";

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 640;

export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
  landmark?: boolean;
  shape?: "rect" | "circle";
}

export const BUILDINGS: Building[] = [
  // Landmarks (selectable locations)
  { x: 188, y: 268, w: 54, h: 60, landmark: true },
  { x: 132, y: 497, w: 38, h: 48, landmark: true },
  { x: 178, y: 503, w: 42, h: 38, landmark: true },
  { x: 487, y: 382, w: 40, h: 40, landmark: true, shape: "circle" },
  { x: 584, y: 222, w: 66, h: 54, landmark: true },
  { x: 735, y: 338, w: 74, h: 40, landmark: true },
  { x: 826, y: 222, w: 58, h: 56, landmark: true },
  // Supporting buildings
  { x: 272, y: 166, w: 58, h: 44, name: "Lassonde" },
  { x: 352, y: 172, w: 44, h: 40, name: "Steacie" },
  { x: 535, y: 412, w: 66, h: 34, name: "Ross" },
  { x: 615, y: 404, w: 62, h: 32, name: "Central Sq." },
  { x: 108, y: 252, w: 60, h: 50, name: "Tait McKenzie" },
  { x: 292, y: 562, w: 70, h: 40, name: "Fine Arts" },
  { x: 420, y: 566, w: 74, h: 44, name: "Schulich" },
  { x: 556, y: 560, w: 66, h: 44, name: "Osgoode" },
  { x: 748, y: 452, w: 56, h: 36, name: "Calumet" },
  { x: 808, y: 512, w: 52, h: 40, name: "Stong" },
  { x: 852, y: 330, w: 54, h: 44, name: "Founders" },
  { x: 478, y: 104, w: 64, h: 32, name: "Farquharson" },
  { x: 636, y: 104, w: 56, h: 34, name: "Petrie" },
  { x: 880, y: 140, w: 52, h: 42, name: "Lumbers" },
];

/** Tree canopy areas (organic blobs). */
export const GREEN_AREAS = [
  {
    id: "north-woods",
    d: "M440,178 C470,140 560,148 620,160 C690,148 770,148 795,182 C812,212 772,236 720,230 C660,224 600,246 560,240 C500,238 452,226 440,205 Z",
    trees: 42,
    box: [430, 140, 815, 250] as const,
  },
  {
    id: "south-grove",
    d: "M292,430 C322,404 402,410 452,440 C500,466 560,482 640,480 C694,482 702,522 662,542 C602,560 522,550 452,547 C382,547 302,532 282,497 C272,470 276,446 292,430 Z",
    trees: 48,
    box: [272, 400, 710, 560] as const,
  },
  {
    id: "west-trees",
    d: "M188,350 C214,338 246,348 252,380 C258,420 240,452 214,452 C190,450 176,420 178,390 C178,368 180,356 188,350 Z",
    trees: 12,
    box: [174, 336, 260, 456] as const,
  },
  {
    id: "library-trees",
    d: "M640,290 C664,282 704,300 716,322 C722,338 708,346 690,342 C668,338 646,322 638,306 C634,298 634,293 640,290 Z",
    trees: 8,
    box: [630, 280, 724, 350] as const,
  },
];

/** Open lawn — Harry W. Arthurs Common. */
export const COMMON = { x: 458, y: 258, w: 110, h: 58 };

export const POND = { cx: 900, cy: 455, rx: 46, ry: 26 };

export const LABELS: Record<LocationId, { x: number; y: number; anchor?: "start" | "middle" | "end" }> = {
  pioneer: { x: 108, y: 96, anchor: "start" },
  bergeron: { x: 215, y: 258 },
  ystation: { x: 395, y: 366 },
  accolade: { x: 176, y: 562 },
  vari: { x: 507, y: 437 },
  scott: { x: 617, y: 212 },
  lanes: { x: 772, y: 395 },
  studentcentre: { x: 855, y: 212 },
};

export const STATIONS: LocationId[] = ["pioneer", "ystation"];

/** Deterministic scatter so server and client render identical trees. */
export function scatterTrees(seed: number, count: number, [x0, y0, x1, y1]: readonly number[]) {
  let s = seed;
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
  return Array.from({ length: count }, () => ({
    x: Math.round((x0 + rand() * (x1 - x0)) * 10) / 10,
    y: Math.round((y0 + rand() * (y1 - y0)) * 10) / 10,
    r: Math.round((6 + rand() * 6) * 10) / 10,
  }));
}

export const SHADOW_OFFSET = {
  morning: { dx: -9, dy: 5 },
  noon: { dx: 2, dy: 3 },
  evening: { dx: 10, dy: 6 },
} as const;
