// Pure helpers shared by CampusMap: API contract types, request building,
// response validation and display formatting. No routing or sun math lives
// here; the backend is the source of truth for those.
import type { FeatureCollection, GeoJsonObject } from "geojson";

export type LatLon = [number, number];

export type RouteStats = {
  seconds: number;
  distance_m: number;
  sun_percent: number;
  sun_seconds: number;
  geometry: GeoJsonObject; // LineString, [lon, lat]
};

export type RouteResponse = {
  when: string;
  w_sun: number;
  cloud_cover: number;
  sun: { elevation_deg: number; azimuth_deg: number; is_daylight: boolean };
  origin: LatLon; // [lat, lon]
  destination: LatLon;
  fastest: RouteStats;
  contextroute: RouteStats;
  extra_seconds: number;
  sun_percent_change: number; // percentage points: contextroute - fastest
};

export type ShadowCollection = FeatureCollection;

export type Scenario = {
  date: string; // YYYY-MM-DD, Toronto local
  minutes: number; // minutes after local midnight
  avoidance: number; // sun avoidance, 0-100 %
  cloud: number; // 0-1
  start: LatLon | null;
  end: LatLon | null;
};

export const API_URL = (
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
).replace(/\/+$/, "");

export const KEELE_CAMPUS_CENTER: LatLon = [43.7735, -79.5019];
// Walk graph extent (43.7665..43.7823, -79.5215..-79.4915) plus a small margin.
export const CAMPUS_BOUNDS: [LatLon, LatLon] = [
  [43.764, -79.525],
  [43.785, -79.488],
];
export const MIN_ZOOM = 15;

// The backend accepts w_sun 0-50, but routes stop changing well below 10 on
// campus, so 100 % avoidance maps to w_sun = 10 (the old slider's maximum).
export const MAX_W_SUN = 10;
export const DEFAULT_AVOIDANCE = 30;

export const sunWeight = (avoidance: number) =>
  (Math.min(100, Math.max(0, avoidance)) / 100) * MAX_W_SUN;

const pad = (n: number) => String(n).padStart(2, "0");

export const minutesToTime = (m: number) =>
  `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function fmtDuration(seconds: number) {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)} min ${pad(s % 60)} sec`;
}

export function signed(n: number) {
  const r = Math.round(n);
  return r > 0 ? `+${r}` : r < 0 ? `−${-r}` : "0";
}

export type WhenOnly = Pick<Scenario, "date" | "minutes">;

export const shadowKey = (s: WhenOnly) => `${s.date} ${minutesToTime(s.minutes)}`;

export const scenarioKey = (s: Scenario) =>
  [shadowKey(s), s.avoidance, s.cloud, s.start, s.end].join("|");

export function routeQuery(s: Scenario) {
  const q = new URLSearchParams({
    date: s.date,
    time: minutesToTime(s.minutes),
    w_sun: String(sunWeight(s.avoidance)),
    cloud_cover: String(s.cloud),
  });
  if (s.start) {
    q.set("from_lat", String(s.start[0]));
    q.set("from_lon", String(s.start[1]));
  }
  if (s.end) {
    q.set("to_lat", String(s.end[0]));
    q.set("to_lon", String(s.end[1]));
  }
  return q;
}

export const shadowQuery = (s: WhenOnly) =>
  new URLSearchParams({ date: s.date, time: minutesToTime(s.minutes) });

// --- response validation -----------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isLatLon = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);

function isStats(v: unknown) {
  return (
    isObj(v) &&
    isNum(v.seconds) &&
    isNum(v.distance_m) &&
    isNum(v.sun_percent) &&
    isObj(v.geometry) &&
    typeof v.geometry.type === "string"
  );
}

export function parseRoute(v: unknown): RouteResponse {
  if (
    isObj(v) &&
    isObj(v.sun) &&
    isNum(v.sun.elevation_deg) &&
    isNum(v.sun.azimuth_deg) &&
    typeof v.sun.is_daylight === "boolean" &&
    isLatLon(v.origin) &&
    isLatLon(v.destination) &&
    isStats(v.fastest) &&
    isStats(v.contextroute) &&
    isNum(v.extra_seconds) &&
    isNum(v.sun_percent_change)
  ) {
    return v as RouteResponse;
  }
  throw new Error("unexpected /route response");
}

export function parseShadows(v: unknown): ShadowCollection {
  if (isObj(v) && v.type === "FeatureCollection" && Array.isArray(v.features)) {
    return v as unknown as ShadowCollection;
  }
  throw new Error("unexpected /shadows response");
}

export async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { signal });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(`can't reach the backend at ${API_URL}`);
  }
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => null);
    throw new Error(
      isObj(body) && typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`,
    );
  }
  return res.json();
}
