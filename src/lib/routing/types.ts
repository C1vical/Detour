// A location on the map (intersection, building entrance, etc.).
export interface GraphNode {
  id: string;
  name?: string; // optional human-readable label for the UI
  x: number;
  y: number;
  elevation: number; // meters
}

// A walkable path segment between two nodes.
// Edges are two-way: you can walk from `from` to `to` or back.
export interface Edge {
  id: string;

  from: string;
  to: string;

  distance: number; // meters
  walkingTime: number; // seconds

  // Each value is 0–1: the fraction of this segment that is
  // sunny / rain-exposed / effortful (hills, stairs).
  sunExposure: number;
  rainExposure: number;
  elevationEffort: number;

  // HARD CONSTRAINTS: if either fails, the edge can never be used.
  walkable: boolean;
  constructionClosed: boolean;
}

export interface Graph {
  nodes: GraphNode[];
  edges: Edge[];
}

// User preference weights: wt, ws, wr, we in the cost formula.
export interface RouteWeights {
  time: number;
  sun: number;
  rain: number;
  elevation: number;
}

export type RoutePresetName =
  | "fastest"
  | "stayCool"
  | "stayDry"
  | "comfortable";

export interface RouteRequest {
  start: string; // node id
  destination: string; // node id
  graph: Graph;
  // Either a preset name or custom weights (custom weights are normalized).
  weights: RouteWeights | RoutePresetName;
}

// How much each factor contributed to the total cost.
// Used by the "Why this route?" feature.
export interface CostBreakdown {
  timeCost: number;
  sunCost: number;
  rainCost: number;
  elevationCost: number;
}

export interface RouteResult {
  path: string[]; // node ids, start → destination
  edges: string[]; // edge ids used, in order

  distance: number; // meters
  walkingTime: number; // seconds

  // Fraction (0–1) of walking time spent in sun / rain / effort.
  sunExposure: number;
  rainExposure: number;
  elevationEffort: number;

  // T(P), S(P), R(P), E(P): values measured relative to the fastest
  // possible trip time (so T = 1 for the fastest route).
  normalized: {
    time: number;
    sun: number;
    rain: number;
    elevation: number;
  };

  weights: RouteWeights; // the normalized weights that were used
  totalCost: number; // C(P) = sum of the breakdown
  breakdown: CostBreakdown;
}
