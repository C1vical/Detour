// Run with: npm test   (uses Node's built-in test runner, no extra libraries)
import { test } from "node:test";
import assert from "node:assert/strict";

import { demoGraph } from "../../data/demoGraph.ts";
import { calculateRoute, normalizeWeights, ROUTE_PRESETS } from "./calculateRoute.ts";
import type { Graph, RoutePresetName } from "./types.ts";

const QUAD_ROUTE = ["start", "quad", "destination"];
const TREE_ROUTE = ["start", "treeLane", "destination"];
const COVERED_ROUTE = ["start", "library", "destination"];

function route(weights: Parameters<typeof calculateRoute>[0]["weights"], graph: Graph = demoGraph) {
  return calculateRoute({ start: "start", destination: "destination", graph, weights });
}

// Copy of the demo graph with some edges changed.
function modifiedGraph(changes: Record<string, Partial<Graph["edges"][number]>>): Graph {
  return {
    nodes: demoGraph.nodes,
    edges: demoGraph.edges.map((e) => ({ ...e, ...changes[e.id] })),
  };
}

test("Fastest picks the short, exposed quad route", () => {
  const result = route("fastest");
  assert.ok(result);
  assert.deepEqual(result.path, QUAD_ROUTE);
  assert.equal(result.walkingTime, 180);
  assert.equal(result.distance, 240);
  // The fastest route is the reference time, so T(P) = 1.
  assert.ok(Math.abs(result.normalized.time - 1) < 1e-9);
});

test("Stay Cool picks the shaded tree lane", () => {
  assert.deepEqual(route("stayCool")?.path, TREE_ROUTE);
});

test("Stay Dry picks the covered walkway", () => {
  assert.deepEqual(route("stayDry")?.path, COVERED_ROUTE);
});

test("Comfortable avoids the exposed quad", () => {
  assert.notDeepEqual(route("comfortable")?.path, QUAD_ROUTE);
});

test("construction-closed edges are never used", () => {
  for (const preset of Object.keys(ROUTE_PRESETS) as RoutePresetName[]) {
    const result = route(preset);
    assert.ok(result);
    assert.ok(!result.edges.includes("start-destination-shortcut"), preset);
  }

  // Closing the quad forces Fastest onto the next-fastest route.
  const closedQuad = modifiedGraph({ "quad-destination": { constructionClosed: true } });
  assert.deepEqual(route("fastest", closedQuad)?.path, TREE_ROUTE);
});

test("non-walkable edges are never used", () => {
  for (const preset of Object.keys(ROUTE_PRESETS) as RoutePresetName[]) {
    const edges = route(preset)?.edges ?? [];
    assert.ok(!edges.includes("start-highway"), preset);
    assert.ok(!edges.includes("highway-destination"), preset);
  }
});

test("unreachable destination returns null", () => {
  const isolated = modifiedGraph({
    "quad-destination": { walkable: false },
    "treeLane-destination": { constructionClosed: true },
    "library-destination": { walkable: false },
  });
  assert.equal(route("fastest", isolated), null);
});

test("unknown start or destination returns null", () => {
  assert.equal(
    calculateRoute({ start: "nowhere", destination: "destination", graph: demoGraph, weights: "fastest" }),
    null
  );
  assert.equal(
    calculateRoute({ start: "start", destination: "nowhere", graph: demoGraph, weights: "fastest" }),
    null
  );
});

test("start === destination returns a zero-length route", () => {
  const result = calculateRoute({ start: "start", destination: "start", graph: demoGraph, weights: "fastest" });
  assert.ok(result);
  assert.deepEqual(result.path, ["start"]);
  assert.equal(result.walkingTime, 0);
  assert.equal(result.totalCost, 0);
});

test("custom weights are normalized to sum to 1", () => {
  const w = normalizeWeights({ time: 2, sun: 1, rain: 1, elevation: 0 });
  assert.deepEqual(w, { time: 0.5, sun: 0.25, rain: 0.25, elevation: 0 });

  // Negative weights count as 0; all-zero weights become equal weights.
  assert.deepEqual(normalizeWeights({ time: -5, sun: 1, rain: 0, elevation: 0 }), {
    time: 0, sun: 1, rain: 0, elevation: 0,
  });
  assert.deepEqual(normalizeWeights({ time: 0, sun: 0, rain: 0, elevation: 0 }), {
    time: 0.25, sun: 0.25, rain: 0.25, elevation: 0.25,
  });
});

test("custom weights change the chosen route", () => {
  // Scaled-up version of Fastest (×10) gives the same result as the preset.
  const scaled = route({ time: 8, sun: 0.5, rain: 0.5, elevation: 1 });
  assert.deepEqual(scaled?.path, QUAD_ROUTE);
  assert.ok(scaled);
  for (const key of ["time", "sun", "rain", "elevation"] as const) {
    assert.ok(Math.abs(scaled.weights[key] - ROUTE_PRESETS.fastest[key]) < 1e-9, key);
  }

  // Only care about time → quad.
  assert.deepEqual(route({ time: 1, sun: 0, rain: 0, elevation: 0 })?.path, QUAD_ROUTE);
  // Only care about rain → covered walkway.
  assert.deepEqual(route({ time: 0, sun: 0, rain: 1, elevation: 0 })?.path, COVERED_ROUTE);
});

test("breakdown adds up to totalCost", () => {
  const result = route("comfortable");
  assert.ok(result);
  const { timeCost, sunCost, rainCost, elevationCost } = result.breakdown;
  assert.ok(Math.abs(timeCost + sunCost + rainCost + elevationCost - result.totalCost) < 1e-9);
  assert.ok(result.sunExposure >= 0 && result.sunExposure <= 1);
});
