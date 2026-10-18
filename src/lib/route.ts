// Pure helpers shared by CampusMap: API contract types, request building and
// response validation. No routing, sun or weather math lives here; the backend
// is the source of truth for those.
import type { FeatureCollection, GeoJsonObject } from "geojson";

export type LatLon = [number, number];

export type RouteStats = {
  seconds: number;
  distance_m: number;
  sun_percent: number;
  sun_seconds: number;
  rain_percent: number;
  geometry: GeoJsonObject; // LineString, [lon, lat]
};

// Weather at the requested time. Values are null unless source is "live".
export type Weather = {
  source: "live" | "clear_sky" | "unavailable";
  direct_wm2: number | null;
  cloud_cover: number | null; // 0-1
  rain_mm_h: number | null;
};

export type RouteResponse = {
  when: string;
  w_sun: number;
  w_rain: number;
  weather: Weather;
  sun: { elevation_deg: number; azimuth_deg: number; is_daylight: boolean };
  origin: LatLon; // [lat, lon]
  destination: LatLon;
  fastest: RouteStats;
  contextroute: RouteStats;
  extra_seconds: number;
  sun_percent_change: number; // percentage points: contextroute - fastest
  rain_percent_change: number;
};

export type ShadowCollection = FeatureCollection;

export type Scenario = {
  date: string; // YYYY-MM-DD, Toronto local
  minutes: number; // minutes after local midnight
  sunAvoidance: number; // 0-100 %
  avoidRain: boolean;
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
// campus, so 100 % avoidance maps to w_sun = 10.
export const MAX_W_SUN = 10;
export const DEFAULT_AVOIDANCE = 30;
// "Avoid rain" trades up to 10 s of extra walking for each second out in
// moderate rain; it only changes the route while it is raining.
export const AVOID_RAIN_W = 10;

export const sunWeight = (avoidance: number) =>
  (Math.min(100, Math.max(0, avoidance)) / 100) * MAX_W_SUN;

const pad = (n: number) => String(n).padStart(2, "0");

export const minutesToTime = (m: number) =>
  `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

// Current Toronto wall-clock date and time, to the minute.
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

export function routeQuery(s: Scenario) {
  const q = new URLSearchParams({
    date: s.date,
    time: minutesToTime(s.minutes),
    w_sun: String(sunWeight(s.sunAvoidance)),
    w_rain: String(s.avoidRain ? AVOID_RAIN_W : 0),
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

export const shadowQuery = (s: Pick<Scenario, "date" | "minutes">) =>
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
    isNum(v.rain_percent) &&
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
    isNum(v.sun_percent_change) &&
    isObj(v.weather) &&
    ["live", "clear_sky", "unavailable"].includes(v.weather.source as string)
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
