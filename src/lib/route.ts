// API contract, request building and response validation for CampusMap. All routing, sun and
// weather maths lives in the backend.
import type { FeatureCollection, GeoJsonObject } from "geojson";

export type LatLon = [number, number];

export type RouteStats = {
  seconds: number;
  distance_m: number;
  sun_percent: number; // 0-100
  rain_percent: number; // 0-100
  geometry: GeoJsonObject; // LineString, [lon, lat]
};

// Values are null unless source is "live".
export type Weather = {
  source: "live" | "clear_sky" | "unavailable";
  direct_wm2: number | null;
  cloud_cover: number | null; // 0-1
  rain_mm_h: number | null;
};

// The parts of the /route response the UI uses; backend/README.md lists the rest.
export type RouteResponse = {
  route_options: number;
  weather: Weather;
  fastest: RouteStats;
  contextroute: RouteStats; // the Detour route
  extra_seconds: number;
};

export type Scenario = {
  date: string; // YYYY-MM-DD, Toronto local
  minutes: number; // minutes after local midnight
  sunAvoidance: number; // 0-100 %
  avoidRain: boolean;
  start: LatLon;
  end: LatLon;
};

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

export const KEELE_CAMPUS_CENTER: LatLon = [43.7735, -79.5019];
// The walk graph's extent plus a small margin.
export const CAMPUS_BOUNDS: [LatLon, LatLon] = [
  [43.764, -79.525],
  [43.785, -79.488],
];
export const MIN_ZOOM = 15;
export const DEFAULT_AVOIDANCE = 50;
// "Avoid rain" trades up to 10 s of walking for each second out in moderate rain.
const AVOID_RAIN_W = 10;
// Dates the backend accepts.
export const MIN_DATE = "1900-01-01";
export const MAX_DATE = "2100-12-31";

const pad = (n: number) => String(n).padStart(2, "0");

export const minutesToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Toronto wall-clock date and time, to the minute, whatever the device's time zone.
export function nowInToronto(now = new Date()): { date: string; minutes: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Toronto",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  };
}

export const routeQuery = (s: Scenario) =>
  new URLSearchParams({
    date: s.date,
    time: minutesToTime(s.minutes),
    sun_avoidance: String(s.sunAvoidance),
    w_rain: String(s.avoidRain ? AVOID_RAIN_W : 0),
    from_lat: String(s.start[0]),
    from_lon: String(s.start[1]),
    to_lat: String(s.end[0]),
    to_lon: String(s.end[1]),
  });

export const shadowQuery = (s: Pick<Scenario, "date" | "minutes">) =>
  new URLSearchParams({ date: s.date, time: minutesToTime(s.minutes) });

// --- response validation: a bad response becomes an error message, not a crash -----------

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isLatLon = (v: unknown) => Array.isArray(v) && v.length === 2 && v.every(isNum);

const isStats = (v: unknown) =>
  isObj(v) &&
  isNum(v.seconds) &&
  isNum(v.distance_m) &&
  isNum(v.sun_percent) &&
  isNum(v.rain_percent) &&
  isObj(v.geometry) &&
  typeof v.geometry.type === "string";

export function parseRoute(v: unknown): RouteResponse {
  if (
    isObj(v) &&
    isStats(v.fastest) &&
    isStats(v.contextroute) &&
    isNum(v.extra_seconds) &&
    isNum(v.route_options) &&
    isObj(v.weather) &&
    ["live", "clear_sky", "unavailable"].includes(v.weather.source as string)
  ) {
    return v as RouteResponse;
  }
  throw new Error("unexpected /route response");
}

export function parseShadows(v: unknown): FeatureCollection {
  if (isObj(v) && v.type === "FeatureCollection" && Array.isArray(v.features)) {
    return v as unknown as FeatureCollection;
  }
  throw new Error("unexpected /shadows response");
}

// The /campus boundary as a ring of [lat, lon] points (GeoJSON is [lon, lat]).
export function parseCampus(v: unknown): LatLon[] {
  const ring =
    isObj(v) && isObj(v.geometry) && v.geometry.type === "Polygon" && Array.isArray(v.geometry.coordinates)
      ? v.geometry.coordinates[0]
      : null;
  if (Array.isArray(ring) && ring.length >= 4 && ring.every(isLatLon)) {
    return ring.map(([lon, lat]: number[]) => [lat, lon]);
  }
  throw new Error("unexpected /campus response");
}

// Ray casting: is `p` inside the closed `ring`?
export function insideRing([lat, lon]: LatLon, ring: LatLon[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [latI, lonI] = ring[i];
    const [latJ, lonJ] = ring[j];
    if (latI > lat !== latJ > lat && lon < ((lonJ - lonI) * (lat - latI)) / (latJ - latI) + lonI) {
      inside = !inside;
    }
  }
  return inside;
}

// Fetch JSON from the backend; errors carry the backend's message. Aborts are rethrown as-is.
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
    throw new Error(isObj(body) && typeof body.detail === "string" ? body.detail : `HTTP ${res.status}`);
  }
  return res.json();
}
