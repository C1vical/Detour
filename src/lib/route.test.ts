import assert from "node:assert/strict";
import { test } from "node:test";

import {
  getJson,
  insideRing,
  MAX_DATE,
  MIN_DATE,
  minutesToTime,
  nowInToronto,
  parseCampus,
  parseRoute,
  parseShadows,
  routeQuery,
  type Scenario,
  shadowQuery,
} from "./route.ts";

const base: Scenario = {
  date: "2026-06-21",
  minutes: 14 * 60,
  sunAvoidance: 30,
  avoidRain: false,
  start: null,
  end: null,
};

const stats = (seconds: number) => ({
  seconds,
  distance_m: 1648.8,
  sun_percent: 95.1,
  sun_seconds: 900,
  rain_percent: 0,
  geometry: { type: "LineString", coordinates: [[-79.51, 43.7715], [-79.496, 43.779]] },
});

const route = {
  when: "2026-06-21T14:00:00-04:00",
  sun_avoidance: 30,
  w_rain: 0,
  route_options: 4,
  weather: { source: "live", direct_wm2: 640, cloud_cover: 0.2, rain_mm_h: 0 },
  sun: { elevation_deg: 68.06, azimuth_deg: 205.31, is_daylight: true },
  origin: [43.7715, -79.51],
  destination: [43.779, -79.496],
  fastest: stats(1177.7),
  contextroute: stats(1428.4),
  extra_seconds: 250.7,
  sun_percent_change: -33.4,
  rain_percent_change: 0,
};

test("route query carries the current scenario, as numbers in backend units", () => {
  const q = routeQuery({ ...base, sunAvoidance: 50, avoidRain: true });
  assert.equal(q.get("date"), "2026-06-21");
  assert.equal(q.get("time"), "14:00");
  assert.equal(q.get("sun_avoidance"), "50");
  assert.equal(q.get("w_rain"), "10");
  assert.equal(q.has("from_lat"), false);
  assert.equal(q.has("to_lat"), false);
});

test("pins are sent as lat/lon pairs only when set", () => {
  const q = routeQuery({ ...base, start: [43.77, -79.5], end: null });
  assert.equal(q.get("from_lat"), "43.77");
  assert.equal(q.get("from_lon"), "-79.5");
  assert.equal(q.has("to_lat"), false);
  assert.equal(q.has("to_lon"), false);
});

test("sun avoidance is sent as a percent, clamped to 0-100", () => {
  assert.equal(routeQuery({ ...base, sunAvoidance: 0 }).get("sun_avoidance"), "0");
  assert.equal(routeQuery({ ...base, sunAvoidance: 150 }).get("sun_avoidance"), "100");
  assert.equal(routeQuery({ ...base, sunAvoidance: -5 }).get("sun_avoidance"), "0");
});

test("route query changes with every input; shadow query only with date/time", () => {
  const q = (s: Scenario) => routeQuery(s).toString();
  for (const change of [
    { date: "2026-06-22" },
    { minutes: 600 },
    { sunAvoidance: 40 },
    { avoidRain: true },
    { start: [43.77, -79.5] as [number, number] },
    { end: [43.78, -79.49] as [number, number] },
  ]) {
    assert.notEqual(q({ ...base, ...change }), q(base), JSON.stringify(change));
  }
  const sq = (s: Scenario) => shadowQuery(s).toString();
  assert.equal(sq({ ...base, sunAvoidance: 90, avoidRain: true, start: [1, 2] }), sq(base));
  assert.notEqual(sq({ ...base, minutes: 605 }), sq(base));
});

test("time formatting", () => {
  assert.equal(minutesToTime(0), "00:00");
  assert.equal(minutesToTime(14 * 60 + 5), "14:05");
  assert.equal(minutesToTime(1435), "23:55");
});

test("a valid /route response parses", () => {
  assert.equal(parseRoute(route).fastest.seconds, 1177.7);
});

test("a zero-length route (start == end) parses", () => {
  const empty = { ...stats(0), distance_m: 0, sun_percent: 0,
    geometry: { type: "LineString", coordinates: [] } };
  assert.doesNotThrow(() => parseRoute({ ...route, fastest: empty, contextroute: empty }));
});

test("malformed /route responses are rejected instead of crashing the render", () => {
  assert.throws(() => parseRoute(null));
  assert.throws(() => parseRoute({ ...route, fastest: undefined }));
  assert.throws(() => parseRoute({ ...route, extra_seconds: "250" }));
  assert.throws(() => parseRoute({ ...route, route_options: undefined }));
  assert.throws(() => parseRoute({ ...route, sun: { ...route.sun, elevation_deg: null } }));
  assert.throws(() => parseRoute({ ...route, origin: [43.7] }));
  assert.throws(() => parseRoute({ ...route, contextroute: { ...stats(1), geometry: null } }));
  assert.throws(() => parseRoute({ ...route, weather: undefined }));
  assert.throws(() => parseRoute({ ...route, weather: { ...route.weather, source: "guess" } }));
});

test("shadow collections, including the empty night-time one, parse", () => {
  assert.equal(parseShadows({ type: "FeatureCollection", features: [] }).features.length, 0);
  assert.throws(() => parseShadows({ type: "Feature" }));
  assert.throws(() => parseShadows({ type: "FeatureCollection" }));
});

test("getJson surfaces the backend's error detail", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ detail: "start is too far from any walkable path" }), {
      status: 422,
    }),
  );
  await assert.rejects(getJson("/route", new AbortController().signal), {
    message: "start is too far from any walkable path",
  });
});

test("getJson reports an unreachable backend clearly", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(getJson("/route", new AbortController().signal), /can't reach the backend/);
});

test("getJson rethrows aborts untouched so callers can ignore them", async (t) => {
  const controller = new AbortController();
  t.mock.method(globalThis, "fetch", async () => {
    controller.abort();
    throw new DOMException("aborted", "AbortError");
  });
  await assert.rejects(getJson("/route", controller.signal), { name: "AbortError" });
});

test("now is read as Toronto wall-clock time, to the minute", () => {
  // 18:07 UTC in June is 14:07 EDT; 03:03 UTC in January is 22:03 EST the day before.
  assert.deepEqual(nowInToronto(new Date("2026-06-21T18:07:00Z")), { date: "2026-06-21", minutes: 14 * 60 + 7 });
  assert.deepEqual(nowInToronto(new Date("2026-01-15T03:03:00Z")), { date: "2026-01-14", minutes: 22 * 60 + 3 });
});

test("the date picker range is well-formed and covers today", () => {
  for (const d of [MIN_DATE, MAX_DATE]) assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  const today = nowInToronto().date;
  assert.ok(MIN_DATE <= today && today <= MAX_DATE);
});

test("the /campus boundary parses to [lat, lon] and point-in-polygon works", () => {
  // An L-shaped campus: the notch at the top right is outside.
  const lonLat = [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2], [0, 0]];
  const ring = parseCampus({ type: "Feature", geometry: { type: "Polygon", coordinates: [lonLat] } });
  assert.deepEqual(ring[1], [0, 2]);
  assert.equal(insideRing([0.5, 0.5], ring), true);
  assert.equal(insideRing([1.5, 0.5], ring), true); // lat 1.5, lon 0.5: the upper arm
  assert.equal(insideRing([1.5, 1.5], ring), false); // the notch
  assert.equal(insideRing([3, 0.5], ring), false);
  assert.throws(() => parseCampus({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] } }));
});
