/**
 * ============================================================================
 *  MOCK ROUTE RESULTS — FRONTEND PLACEHOLDER ONLY
 * ============================================================================
 * Stands in for the routing/optimisation engine and the environmental
 * simulation so the UI can be demoed. Numbers are illustrative, not physics.
 *
 * Replace by pointing `findRoutes` in ./routeService.ts at the real backend;
 * nothing else in the UI imports this file directly except for the initial
 * render in ContextRouteApp.
 * ============================================================================
 */
import { MAP_NODES, METRES_PER_UNIT, WALKWAYS, type Walkway } from "../campus";
import type {
  Conditions,
  RouteCandidate,
  RouteMode,
  RouteRequest,
  RouteResponse,
  RouteStrategy,
} from "./types";

const WALKING_SPEED = 1.35; // m/s
const INDOOR_SLOWDOWN = 1.15; // doors, corridors, crowds
const EFFORT_SCALE = 12; // metres of climb that counts as "max effort"

// Rough stand-ins for the simulation team's sun / weather model.
const SHADOW_BOOST: Record<Conditions["timeOfDay"], number> = { morning: 0.2, noon: 0, evening: 0.3 };
const TIME_SUN: Record<Conditions["timeOfDay"], number> = { morning: 0.7, noon: 1, evening: 0.5 };
const WEATHER_SUN: Record<Conditions["weather"], number> = { sunny: 1, cloudy: 0.4, rain: 0.15 };
const WEATHER_RAIN: Record<Conditions["weather"], number> = { sunny: 0.1, cloudy: 0.4, rain: 1 };

const MODE_WEIGHTS: Record<RouteMode, { time: number; sun: number; rain: number; effort: number }> = {
  fastest: { time: 1, sun: 0.1, rain: 0.1, effort: 0.1 },
  cool: { time: 0.3, sun: 1.6, rain: 0.2, effort: 0.1 },
  dry: { time: 0.3, sun: 0.2, rain: 1.6, effort: 0.1 },
  comfortable: { time: 0.6, sun: 0.6, rain: 0.6, effort: 0.6 },
};

interface Edge {
  to: string;
  walkway: Walkway;
  length: number; // metres
}

function segmentTime(e: Edge) {
  return (e.length / WALKING_SPEED) * (e.walkway.covered >= 0.9 ? INDOOR_SLOWDOWN : 1);
}

const STRATEGIES: { strategy: RouteStrategy; label: string; weight: (e: Edge) => number }[] = [
  { strategy: "fast", label: "Fastest", weight: (e) => segmentTime(e) },
  { strategy: "shaded", label: "Shaded", weight: (e) => segmentTime(e) * (1 + 3 * (1 - e.walkway.shade)) },
  { strategy: "covered", label: "Covered", weight: (e) => segmentTime(e) * (1 + 3 * (1 - e.walkway.covered)) },
];

function buildGraph(conditions: Conditions) {
  const graph = new Map<string, Edge[]>();
  for (const w of WALKWAYS) {
    if (conditions.closeCentralWalkway && w.central) continue;
    const a = MAP_NODES[w.from];
    const b = MAP_NODES[w.to];
    const length = Math.hypot(a.x - b.x, a.y - b.y) * METRES_PER_UNIT;
    graph.set(w.from, [...(graph.get(w.from) ?? []), { to: w.to, walkway: w, length }]);
    graph.set(w.to, [...(graph.get(w.to) ?? []), { to: w.from, walkway: w, length }]);
  }
  return graph;
}

/** Minimal Dijkstra — only here so the mock can produce plausible paths. */
function cheapestPath(graph: Map<string, Edge[]>, from: string, to: string, weight: (e: Edge) => number) {
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const done = new Set<string>();
  for (;;) {
    let current: string | undefined;
    let best = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < best) {
        best = d;
        current = id;
      }
    }
    if (current === undefined) return null;
    if (current === to) break;
    done.add(current);
    for (const e of graph.get(current) ?? []) {
      const next = best + weight(e);
      if (next < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, next);
        prev.set(e.to, current);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;

function evaluate(path: string[], graph: Map<string, Edge[]>, { mode, conditions }: RouteRequest) {
  let distance = 0;
  let time = 0;
  let sunMetres = 0;
  let uncoveredMetres = 0;
  let shadedMetres = 0;
  let coveredMetres = 0;
  let climb = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const edge = graph.get(path[i])!.find((e) => e.to === path[i + 1])!;
    const w = edge.walkway;
    const shade = w.shade + (1 - w.shade) * SHADOW_BOOST[conditions.timeOfDay];
    distance += edge.length;
    time += segmentTime(edge);
    sunMetres += edge.length * (1 - Math.max(shade, w.covered));
    uncoveredMetres += edge.length * (1 - w.covered);
    shadedMetres += edge.length * shade;
    coveredMetres += edge.length * w.covered;
    climb += w.climb;
  }

  const sunFraction = sunMetres / distance;
  const uncoveredFraction = uncoveredMetres / distance;
  const sunSeverity = TIME_SUN[conditions.timeOfDay] * WEATHER_SUN[conditions.weather];
  const rainSeverity = WEATHER_RAIN[conditions.weather];
  const elevationEffort = Math.min(1, climb / EFFORT_SCALE);

  const w = MODE_WEIGHTS[mode];
  const breakdown = {
    timeCost: round(w.time * (time / 60)),
    sunCost: round(w.sun * 10 * sunFraction * Math.max(0.35, sunSeverity)),
    rainCost: round(w.rain * 10 * uncoveredFraction * Math.max(0.35, rainSeverity)),
    elevationCost: round(w.effort * 10 * elevationEffort),
  };

  return {
    path,
    distance: Math.round(distance),
    walkingTime: Math.round(time),
    sunExposure: round(sunFraction * sunSeverity),
    rainExposure: round(uncoveredFraction * rainSeverity),
    elevationEffort: round(elevationEffort),
    totalCost: round(breakdown.timeCost + breakdown.sunCost + breakdown.rainCost + breakdown.elevationCost),
    breakdown,
    shadedShare: round(shadedMetres / distance),
    shelteredShare: round(coveredMetres / distance),
  };
}

export function getMockRouteResult(request: RouteRequest): RouteResponse {
  const graph = buildGraph(request.conditions);
  const seen = new Set<string>();
  const candidates: RouteCandidate[] = [];

  for (const { strategy, label, weight } of STRATEGIES) {
    const path = cheapestPath(graph, request.start, request.destination, weight);
    if (!path) continue;
    const key = path.join(">");
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({ id: strategy, strategy, label, ...evaluate(path, graph, request) });
  }

  if (candidates.length === 0) throw new Error("No walkable route between these locations.");

  const minBy = (score: (c: RouteCandidate) => number) =>
    candidates.reduce((best, c) => (score(c) < score(best) ? c : best));

  return {
    candidates,
    recommendedId: minBy((c) => c.totalCost).id,
    fastestId: minBy((c) => c.walkingTime).id,
  };
}
