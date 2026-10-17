import type { Edge, Graph, GraphNode } from "./types.ts";

// HARD CONSTRAINTS: an edge is usable only if it is walkable
// and not closed for construction.
export function isEdgeUsable(edge: Edge): boolean {
  return edge.walkable && !edge.constructionClosed;
}

export function getNode(
  graph: Graph,
  nodeId: string
): GraphNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

// All usable edges touching a node (edges are two-way).
export function getConnectedEdges(
  graph: Graph,
  nodeId: string
): Edge[] {
  return graph.edges.filter((edge) => {
    const connected = edge.from === nodeId || edge.to === nodeId;
    return connected && isEdgeUsable(edge);
  });
}

// Given an edge and one of its ends, return the node on the other end.
export function getOtherEnd(edge: Edge, nodeId: string): string {
  return edge.from === nodeId ? edge.to : edge.from;
}
