import type { LocationId } from "../campus";

export type RouteMode = "fastest" | "cool" | "dry" | "comfortable";
export type TimeOfDay = "morning" | "noon" | "evening";
export type Weather = "sunny" | "cloudy" | "rain";

/** RouteLab "what if?" inputs. The simulation team's model consumes these. */
export interface Conditions {
  timeOfDay: TimeOfDay;
  weather: Weather;
  closeCentralWalkway: boolean;
}

export interface RouteRequest {
  start: LocationId;
  destination: LocationId;
  mode: RouteMode;
  conditions: Conditions;
}

export interface CostBreakdown {
  timeCost: number;
  sunCost: number;
  rainCost: number;
  elevationCost: number;
}

/**
 * Shape of a single result from the routing engine.
 * Units the UI assumes:
 *   distance        metres
 *   walkingTime     seconds
 *   sunExposure     0–1 (share of walk in direct sun, weighted by conditions)
 *   rainExposure    0–1 (share of walk exposed to rain, weighted by conditions)
 *   elevationEffort 0–1 (normalised climbing effort)
 */
export interface RouteResult {
  path: string[];
  distance: number;
  walkingTime: number;
  sunExposure: number;
  rainExposure: number;
  elevationEffort: number;
  totalCost: number;
  breakdown: CostBreakdown;
}

/** Which flavour of path a candidate represents (drives map colour). */
export type RouteStrategy = "fast" | "shaded" | "covered";

/** A RouteResult plus the frontend metadata needed to draw/compare it. */
export interface RouteCandidate extends RouteResult {
  id: string;
  strategy: RouteStrategy;
  label: string;
  /** Optional extras — used for nicer "Why this route?" copy when present. */
  shadedShare?: number;
  shelteredShare?: number;
}

export interface RouteResponse {
  candidates: RouteCandidate[];
  /** Candidate the engine recommends for the requested mode. */
  recommendedId: string;
  /** Candidate with the lowest walking time (for the comparison card). */
  fastestId: string;
}
