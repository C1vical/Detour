import assert from "node:assert/strict";
import { test } from "node:test";

import {
  fmtDuration,
  getJson,
  minutesToTime,
  parseRoute,
  parseShadows,
  routeQuery,
  type Scenario,
  scenarioKey,
  shadowKey,
  signed,
  sunWeight,
} from "./route.ts";

const base: Scenario = {
  date: "2026-06-21",
  minutes: 14 * 60,
  avoidance: 30,
  cloud: 0,
  start: null,
  end: null,
};

const stats = (seconds: number) => ({
  seconds,
  distance_m: 1648.8,
  sun_percent: 95.1,
  sun_seconds: 900,
  geometry: { type: "LineString", coordinates: [[-79.51, 43.7715], [-79.496, 43.779]] },
});

const route = {
  when: "2026-06-21T14:00:00-04:00",
  w_sun: 3,
  cloud_cover: 0,
  sun: { elevation_deg: 68.06, azimuth_deg: 205.31, is_daylight: true },
  origin: [43.7715, -79.51],
  destination: [43.779, -79.496],
  fastest: stats(1177.7),
  contextroute: stats(1428.4),
  extra_seconds: 250.7,
  sun_percent_change: -33.4,
};

test("sun avoidance percent maps linearly onto w_sun and is clamped", () => {
  assert.equal(sunWeight(0), 0);
  assert.equal(sunWeight(30), 3);
  assert.equal(sunWeight(100), 10);
  assert.equal(sunWeight(150), 10);
  assert.equal(sunWeight(-5), 0);
});

test("route query carries the current scenario, as numbers in backend units", () => {
  const q = routeQuery({ ...base, avoidance: 50, cloud: 0.25 });
  assert.equal(q.get("date"), "2026-06-21");
  assert.equal(q.get("time"), "14:00");
  assert.equal(q.get("w_sun"), "5");
  assert.equal(q.get("cloud_cover"), "0.25");
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

test("w_sun of 0 % avoidance is exactly 0 (fastest route)", () => {
  assert.equal(routeQuery({ ...base, avoidance: 0 }).get("w_sun"), "0");
});

test("scenario key changes with every input; shadow key only with date/time", () => {
  const k = scenarioKey(base);
  for (const change of [
    { date: "2026-06-22" },
    { minutes: 600 },
    { avoidance: 40 },
    { cloud: 0.5 },
    { start: [43.77, -79.5] as [number, number] },
    { end: [43.78, -79.49] as [number, number] },
  ]) {
    assert.notEqual(scenarioKey({ ...base, ...change }), k, JSON.stringify(change));
  }
  assert.equal(shadowKey({ ...base, avoidance: 90, start: [1, 2] } as Scenario), shadowKey(base));
  assert.notEqual(shadowKey({ ...base, minutes: 605 }), shadowKey(base));
});

test("time formatting", () => {
  assert.equal(minutesToTime(0), "00:00");
  assert.equal(minutesToTime(14 * 60 + 5), "14:05");
  assert.equal(minutesToTime(1435), "23:55");
});

test("durations round before splitting into minutes and seconds", () => {
  assert.equal(fmtDuration(1177.7), "19 min 38 sec");
  assert.equal(fmtDuration(59.6), "1 min 00 sec");
  assert.equal(fmtDuration(0), "0 min 00 sec");
});

test("signed numbers never show -0", () => {
  assert.equal(signed(250.7), "+251");
  assert.equal(signed(-33.4), "−33");
  assert.equal(signed(-0.4), "0");
  assert.equal(signed(0), "0");
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
  assert.throws(() => parseRoute({ ...route, sun: { ...route.sun, elevation_deg: null } }));
  assert.throws(() => parseRoute({ ...route, origin: [43.7] }));
  assert.throws(() => parseRoute({ ...route, contextroute: { ...stats(1), geometry: null } }));
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
