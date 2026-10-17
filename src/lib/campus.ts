/**
 * York University (Keele campus) — schematic campus model used by the map.
 *
 * Coordinates are in SVG map units (viewBox 0 0 1000 640), NOT lat/lng.
 * They are laid out to resemble the campus, not to be geographically exact.
 *
 * Any `path: string[]` returned by the routing engine is drawn by looking up
 * each id in `MAP_NODES`, so the backend should use these node ids (or we add
 * a small id-mapping step when integrating).
 */

export type LocationId =
  | "pioneer"
  | "bergeron"
  | "ystation"
  | "accolade"
  | "vari"
  | "scott"
  | "lanes"
  | "studentcentre";

export interface CampusLocation {
  id: LocationId;
  name: string;
  shortName: string;
}

export const LOCATIONS: CampusLocation[] = [
  { id: "bergeron", name: "Bergeron Centre for Engineering Excellence", shortName: "Bergeron Centre" },
  { id: "vari", name: "Vari Hall", shortName: "Vari Hall" },
  { id: "scott", name: "Scott Library", shortName: "Scott Library" },
  { id: "lanes", name: "York Lanes", shortName: "York Lanes" },
  { id: "studentcentre", name: "Student Centre", shortName: "Student Centre" },
  { id: "accolade", name: "Accolade East & West", shortName: "Accolade" },
  { id: "ystation", name: "York University Station", shortName: "York U Station" },
  { id: "pioneer", name: "Pioneer Village Station", shortName: "Pioneer Village" },
];

export const LOCATION_BY_ID = Object.fromEntries(LOCATIONS.map((l) => [l.id, l])) as Record<
  LocationId,
  CampusLocation
>;

export interface MapPoint {
  x: number;
  y: number;
}

/** Every routable point: destinations plus intermediate walkway junctions. */
export const MAP_NODES: Record<string, MapPoint> = {
  // Destinations
  pioneer: { x: 90, y: 100 },
  bergeron: { x: 250, y: 300 },
  ystation: { x: 395, y: 335 },
  accolade: { x: 210, y: 485 },
  vari: { x: 490, y: 390 },
  scott: { x: 610, y: 285 },
  lanes: { x: 725, y: 355 },
  studentcentre: { x: 815, y: 250 },
  // Junctions
  nwgate: { x: 170, y: 170 },
  lassonde: { x: 300, y: 225 },
  commonsN: { x: 430, y: 250 },
  commons: { x: 455, y: 330 },
  cw1: { x: 555, y: 330 },
  cw2: { x: 655, y: 335 },
  ross: { x: 565, y: 428 },
  csq: { x: 645, y: 420 },
  northwoods: { x: 530, y: 200 },
  ne: { x: 705, y: 190 },
  grove1: { x: 335, y: 445 },
  grove2: { x: 470, y: 500 },
  grove3: { x: 620, y: 505 },
};

/** Map units → metres (map is ~1.1 km across). */
export const METRES_PER_UNIT = 1.1;

export interface Walkway {
  from: string;
  to: string;
  /** 0–1 share of the segment under tree/building shade at noon. */
  shade: number;
  /** 0–1 share of the segment that is covered or indoors. */
  covered: number;
  /** Metres of climbing along the segment (stairs / slopes). */
  climb: number;
  /** Part of the Central Walkway (closable in RouteLab). */
  central?: boolean;
}

/**
 * Walkway network. Shade / cover / climb values are illustrative placeholders
 * for the demo; the simulation team's model will supply real values.
 */
export const WALKWAYS: Walkway[] = [
  { from: "pioneer", to: "nwgate", shade: 0.25, covered: 0, climb: 1 },
  { from: "nwgate", to: "lassonde", shade: 0.35, covered: 0, climb: 2 },
  { from: "nwgate", to: "bergeron", shade: 0.3, covered: 0, climb: 1 },
  { from: "bergeron", to: "lassonde", shade: 0.5, covered: 0.6, climb: 0 },
  { from: "bergeron", to: "ystation", shade: 0.1, covered: 0.2, climb: 0 },
  { from: "bergeron", to: "accolade", shade: 0.5, covered: 0, climb: 2 },
  { from: "accolade", to: "grove1", shade: 0.85, covered: 0, climb: 1 },
  { from: "grove1", to: "ystation", shade: 0.6, covered: 0, climb: 1 },
  { from: "grove1", to: "vari", shade: 0.75, covered: 0, climb: 2 },
  { from: "grove1", to: "grove2", shade: 0.9, covered: 0, climb: 1 },
  { from: "grove2", to: "grove3", shade: 0.9, covered: 0, climb: 1 },
  { from: "grove2", to: "ross", shade: 0.5, covered: 0, climb: 1 },
  { from: "grove3", to: "csq", shade: 0.6, covered: 0, climb: 1 },
  { from: "lassonde", to: "commonsN", shade: 0.7, covered: 0, climb: 1 },
  { from: "commonsN", to: "commons", shade: 0.15, covered: 0, climb: 0 },
  { from: "ystation", to: "commons", shade: 0.1, covered: 0.2, climb: 0 },
  { from: "commons", to: "vari", shade: 0.2, covered: 0.4, climb: 0 },
  { from: "commons", to: "cw1", shade: 0.05, covered: 0, climb: 0, central: true },
  { from: "cw1", to: "cw2", shade: 0.05, covered: 0, climb: 0, central: true },
  { from: "cw1", to: "scott", shade: 0.15, covered: 0, climb: 1 },
  { from: "cw2", to: "lanes", shade: 0.1, covered: 0, climb: 0 },
  { from: "cw2", to: "studentcentre", shade: 0.1, covered: 0, climb: 1 },
  { from: "ystation", to: "vari", shade: 0.3, covered: 0.75, climb: 0 },
  { from: "vari", to: "ross", shade: 0, covered: 1, climb: 1 },
  { from: "ross", to: "csq", shade: 0, covered: 1, climb: 0 },
  { from: "csq", to: "lanes", shade: 0, covered: 1, climb: 0 },
  { from: "csq", to: "scott", shade: 0, covered: 1, climb: 1 },
  { from: "commonsN", to: "northwoods", shade: 0.9, covered: 0, climb: 2 },
  { from: "northwoods", to: "scott", shade: 0.9, covered: 0, climb: 1 },
  { from: "northwoods", to: "ne", shade: 0.9, covered: 0, climb: 2 },
  { from: "ne", to: "studentcentre", shade: 0.8, covered: 0, climb: 1 },
  { from: "scott", to: "ne", shade: 0.7, covered: 0, climb: 2 },
  { from: "scott", to: "lanes", shade: 0.75, covered: 0.2, climb: 0 },
  { from: "lanes", to: "studentcentre", shade: 0.3, covered: 0.55, climb: 1 },
];
