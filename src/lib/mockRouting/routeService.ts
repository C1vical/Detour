import { getMockRouteResult } from "./mockRouteResult";
import type { RouteRequest, RouteResponse } from "./types";

/**
 * The single integration point between the UI and the routing engine.
 *
 * TODO(backend): replace the mock with the real call, e.g.
 *   const res = await fetch("/api/route", { method: "POST", body: JSON.stringify(request) });
 *   return (await res.json()) as RouteResponse;
 */
export async function findRoutes(request: RouteRequest): Promise<RouteResponse> {
  await new Promise((resolve) => setTimeout(resolve, 350)); // simulate network latency
  return getMockRouteResult(request);
}
