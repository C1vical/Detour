import type { Edge, RoutePresetName, RouteWeights } from "./types.ts";

export const ROUTE_PRESETS: Record<RoutePresetName, RouteWeights> = {
  fastest: { time: 0.8, sun: 0.05, rain: 0.05, elevation: 0.1 },
  stayCool: { time: 0.25, sun: 0.6, rain: 0.05, elevation: 0.1 },
  stayDry: { time: 0.25, sun: 0.05, rain: 0.6, elevation: 0.1 },
  comfortable: { time: 0.3, sun: 0.25, rain: 0.15, elevation: 0.3 },
};

// Negative or invalid numbers count as 0.
function cleanWeight(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

// Scale weights so they add up to 1.
// Example: { time: 2, sun: 2, rain: 0, elevation: 0 } → 0.5, 0.5, 0, 0
// If every weight is 0, treat all four factors equally.
export function normalizeWeights(weights: RouteWeights): RouteWeights {
  const time = cleanWeight(weights.time);
  const sun = cleanWeight(weights.sun);
  const rain = cleanWeight(weights.rain);
  const elevation = cleanWeight(weights.elevation);

  const sum = time + sun + rain + elevation;
  if (sum === 0) {
    return { time: 0.25, sun: 0.25, rain: 0.25, elevation: 0.25 };
  }

  return {
    time: time / sum,
    sun: sun / sum,
    rain: rain / sum,
    elevation: elevation / sum,
  };
}

// Accept a preset name or custom weights, always return weights summing to 1.
export function resolveWeights(
  weights: RouteWeights | RoutePresetName
): RouteWeights {
  if (typeof weights === "string") {
    return ROUTE_PRESETS[weights];
  }
  return normalizeWeights(weights);
}

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

// The four raw measurements of one edge, all in seconds:
// - time:      seconds spent walking this edge
// - sun:       seconds spent in the sun   (sunExposure × time)
// - rain:      seconds exposed to rain    (rainExposure × time)
// - elevation: seconds of uphill effort   (elevationEffort × time)
// Weighting by time means a long sunny edge counts more than a short one.
export function getEdgeMeasures(edge: Edge) {
  const time = Math.max(edge.walkingTime, 0);
  return {
    time,
    sun: clamp01(edge.sunExposure) * time,
    rain: clamp01(edge.rainExposure) * time,
    elevation: clamp01(edge.elevationEffort) * time,
  };
}

// Weighted cost of one edge:
//   cost = (wt·time + ws·sun + wr·rain + we·elevation) / referenceTime
// Dividing by referenceTime (the fastest possible trip) normalizes the
// numbers, so a path's T(P) = 1 means "as long as the fastest route".
export function calculateEdgeCost(
  edge: Edge,
  weights: RouteWeights,
  referenceTime: number
): number {
  const m = getEdgeMeasures(edge);
  return (
    (weights.time * m.time +
      weights.sun * m.sun +
      weights.rain * m.rain +
      weights.elevation * m.elevation) /
    referenceTime
  );
}
