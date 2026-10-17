import { getConnectedEdges, getNode, getOtherEnd } from "./graph.ts";
import type { Edge, Graph } from "./types.ts";

export interface ShortestPath {
  nodes: string[]; // node ids, start → destination
  edges: Edge[]; // edges used, in order
  cost: number; // total cost of the path
}

// How we reached a node: which node we came from, and along which edge.
interface Step {
  fromNode: string;
  edge: Edge;
}

// Dijkstra's algorithm: finds the path with the lowest total edge cost.
// `edgeCost` decides what "cost" means (time, weighted cost, ...).
// Only usable edges are considered (see getConnectedEdges).
// Returns null if the destination cannot be reached.
export function dijkstra(
  graph: Graph,
  start: string,
  destination: string,
  edgeCost: (edge: Edge) => number
): ShortestPath | null {
  if (!getNode(graph, start) || !getNode(graph, destination)) {
    return null;
  }

  // bestCost[node] = cheapest known cost to reach that node from start.
  const bestCost = new Map<string, number>();
  const previous = new Map<string, Step>();
  const visited = new Set<string>();

  for (const node of graph.nodes) {
    bestCost.set(node.id, Infinity);
  }
  bestCost.set(start, 0);

  while (true) {
    // 1. Pick the unvisited node with the smallest known cost.
    let current: string | null = null;
    let currentCost = Infinity;
    for (const [nodeId, cost] of bestCost) {
      if (!visited.has(nodeId) && cost < currentCost) {
        current = nodeId;
        currentCost = cost;
      }
    }

    // No reachable nodes left, or we reached the destination: stop.
    if (current === null || current === destination) {
      break;
    }
    visited.add(current);

    // 2. Try to improve the cost of each neighbor through `current`.
    for (const edge of getConnectedEdges(graph, current)) {
      const neighbor = getOtherEnd(edge, current);
      if (visited.has(neighbor)) continue;

      const newCost = currentCost + edgeCost(edge);
      if (newCost < (bestCost.get(neighbor) ?? Infinity)) {
        bestCost.set(neighbor, newCost);
        previous.set(neighbor, { fromNode: current, edge });
      }
    }
  }

  const totalCost = bestCost.get(destination) ?? Infinity;
  if (totalCost === Infinity) {
    return null;
  }

  return reconstructPath(start, destination, previous, totalCost);
}

// Walk backwards from the destination using `previous`, then reverse.
export function reconstructPath(
  start: string,
  destination: string,
  previous: Map<string, Step>,
  totalCost: number
): ShortestPath {
  const nodes = [destination];
  const edges: Edge[] = [];

  let current = destination;
  while (current !== start) {
    const step = previous.get(current);
    if (!step) break; // should not happen for a reachable destination
    edges.push(step.edge);
    nodes.push(step.fromNode);
    current = step.fromNode;
  }

  return {
    nodes: nodes.reverse(),
    edges: edges.reverse(),
    cost: totalCost,
  };
}
