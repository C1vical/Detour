import { calculateEdgeCost, getEdgeMeasures, resolveWeights } from "./cost.ts";
import { dijkstra, type ShortestPath } from "./dijkstra.ts";
import type { RouteRequest, RouteResult, RouteWeights } from "./types.ts";

// Re-exported so the frontend can import everything from this file.
export { ROUTE_PRESETS, normalizeWeights } from "./cost.ts";

// Find the best route for the user's preferences.
//
//   C(P) = wt·T(P) + ws·S(P) + wr·R(P) + we·E(P)
//   P*   = argmin C(P)
//
// Returns null if there is no walkable route (or a node id is unknown).
export function calculateRoute({
  start,
  destination,
  graph,
  weights,
}: RouteRequest): RouteResult | null {
  const finalWeights = resolveWeights(weights);

  // Step 1: find the fastest possible walking time. This is the
  // reference we normalize by. If even this fails, there is no route.
  const fastest = dijkstra(graph, start, destination, (edge) =>
    getEdgeMeasures(edge).time
  );
  if (!fastest) {
    return null;
  }
  // Guard against dividing by 0 (e.g. start === destination).
  const referenceTime = Math.max(fastest.cost, 1);

  // Step 2: find the path with the lowest weighted cost C(P).
  const best = dijkstra(graph, start, destination, (edge) =>
    calculateEdgeCost(edge, finalWeights, referenceTime)
  );
  if (!best) {
    return null;
  }

  return summarizeRoute(best, finalWeights, referenceTime);
}

// Add up the totals along the chosen path and build the breakdown.
function summarizeRoute(
  route: ShortestPath,
  weights: RouteWeights,
  referenceTime: number
): RouteResult {
  let distance = 0;
  let time = 0;
  let sunSeconds = 0;
  let rainSeconds = 0;
  let effortSeconds = 0;

  for (const edge of route.edges) {
    const m = getEdgeMeasures(edge);
    distance += edge.distance;
    time += m.time;
    sunSeconds += m.sun;
    rainSeconds += m.rain;
    effortSeconds += m.elevation;
  }

  // T(P), S(P), R(P), E(P)
  const normalized = {
    time: time / referenceTime,
    sun: sunSeconds / referenceTime,
    rain: rainSeconds / referenceTime,
    elevation: effortSeconds / referenceTime,
  };

  const breakdown = {
    timeCost: weights.time * normalized.time,
    sunCost: weights.sun * normalized.sun,
    rainCost: weights.rain * normalized.rain,
    elevationCost: weights.elevation * normalized.elevation,
  };

  // Fraction of the walk spent in each condition (0 for an empty path).
  const fractionOfWalk = (seconds: number) => (time > 0 ? seconds / time : 0);

  return {
    path: route.nodes,
    edges: route.edges.map((edge) => edge.id),
    distance,
    walkingTime: time,
    sunExposure: fractionOfWalk(sunSeconds),
    rainExposure: fractionOfWalk(rainSeconds),
    elevationEffort: fractionOfWalk(effortSeconds),
    normalized,
    weights,
    totalCost:
      breakdown.timeCost +
      breakdown.sunCost +
      breakdown.rainCost +
      breakdown.elevationCost,
    breakdown,
  };
}
