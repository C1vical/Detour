"""Sun- and rain-aware walking router: A* / Dijkstra with a multi-objective edge cost.

    cost(e, t) = w_t * tau_e + w_s * S_e(t) + w_r * W_e(t)

tau_e is traversal time (s), S_e(t) is sun exposure (sun-seconds) and W_e(t)
rain exposure (rain-seconds, see exposure.py) for an edge entered at time t.
All are in seconds so the weights read as "how many seconds of walking would I
trade for one sun-second (or rain-second)".

    w_s = w_r = 0  -> pure fastest route (classic shortest path by time)
    w_s large      -> hug the shade
    w_r large      -> stay under roofs while it rains

Because S_e and W_e depend on when the edge is entered, this is a time-dependent
shortest-path problem. Each search label carries its arrival time, and the cost
of an edge is evaluated at that time. We settle nodes in order of accumulated
cost as in ordinary Dijkstra; strictly that is exact only if arriving earlier
never makes the rest of the walk costlier. A walk lasts minutes while the sun
moves slowly, so the approximation error is negligible here (note it in the docs).

A* heuristic: h(n) = w_t * straight_line(n, goal) / v. For pure travel-time
searches this is an admissible and consistent lower bound. When sun or rain
exposure is weighted, edge costs depend on arrival time, so the settling rule is not
guaranteed to remain exact; those searches use Dijkstra ordering instead.
"""
from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from .exposure import ExposureModel


class NoRouteError(Exception):
    pass


@dataclass
class RouteResult:
    nodes: list[int]
    edges: list[int]                 # edge indices into ExposureModel.edges
    seconds: float                   # travel time T
    distance_m: float
    sun_seconds: float               # S(P), sun-seconds actually received
    full_sun_seconds: float          # what the same path would give with no shade
    rain_seconds: float              # W(P), rain-seconds actually received
    full_rain_seconds: float         # what the same path would give with no shelter
    expanded: int = 0                # nodes settled by the search (for comparing A* vs Dijkstra)
    cost: float = 0.0

    @property
    def sun_percent(self) -> float:
        """Share of the walk spent in direct sun, as a % of what open ground would give."""
        return 100.0 * self.sun_seconds / self.full_sun_seconds if self.full_sun_seconds > 0 else 0.0

    @property
    def rain_percent(self) -> float:
        """Share of the walk spent out in the rain, as a % of what open ground would give."""
        return 100.0 * self.rain_seconds / self.full_rain_seconds if self.full_rain_seconds > 0 else 0.0


def route(model: ExposureModel, origin: int, dest: int, start: datetime,
          w_time: float = 1.0, w_sun: float = 0.0, w_rain: float = 0.0,
          use_astar: bool = True) -> RouteResult:
    """Best route from `origin` to `dest` node ids, leaving at `start` (tz-aware)."""
    g = model.graph
    gx, gy = g.nodes[dest]["x"], g.nodes[dest]["y"]

    def heuristic(n: int) -> float:
        if not use_astar or w_sun or w_rain:
            return 0.0
        nd = g.nodes[n]
        return w_time * math.hypot(nd["x"] - gx, nd["y"] - gy) / model.speed

    counter = itertools.count()  # tie-breaker so the heap never compares nodes
    best: dict[int, float] = {origin: 0.0}
    came: dict[int, tuple[int, int]] = {}      # node -> (prev node, edge idx)
    elapsed: dict[int, float] = {origin: 0.0}  # seconds since `start` at best label
    heap = [(heuristic(origin), 0.0, next(counter), origin)]
    settled: set[int] = set()

    while heap:
        _, cost_u, _, u = heapq.heappop(heap)
        if cost_u != best.get(u):
            continue
        settled.add(u)
        if u == dest:
            break
        t_u = start + timedelta(seconds=elapsed[u])
        for v, parallel in g[u].items():
            for key in parallel:
                ei = model.edge_index[(u, v, key)]
                tau = model.traversal_seconds(ei)
                c = best[u] + w_time * tau
                if w_sun:
                    c += w_sun * model.sun_seconds(ei, t_u)
                if w_rain:
                    c += w_rain * model.rain_seconds(ei, t_u)
                if c < best.get(v, math.inf):
                    best[v] = c
                    came[v] = (u, ei)
                    elapsed[v] = elapsed[u] + tau
                    heapq.heappush(heap, (c + heuristic(v), c, next(counter), v))

    if dest not in settled:
        raise NoRouteError(f"no route from {origin} to {dest}")

    nodes, edges = [dest], []
    while nodes[-1] != origin:
        prev, ei = came[nodes[-1]]
        nodes.append(prev)
        edges.append(ei)
    nodes.reverse()
    edges.reverse()
    return _summarise(model, nodes, edges, start, best[dest], len(settled))


def _summarise(model: ExposureModel, nodes: list[int], edges: list[int], start: datetime,
               cost: float, expanded: int) -> RouteResult:
    t = 0.0
    sun = full_sun = rain = full_rain = dist = 0.0
    for ei in edges:
        enter = start + timedelta(seconds=t)
        sun += model.sun_seconds(ei, enter)
        full_sun += model.full_sun_seconds(ei, enter)
        rain += model.rain_seconds(ei, enter)
        full_rain += model.full_rain_seconds(ei, enter)
        dist += model.edges[ei].length
        t += model.traversal_seconds(ei)
    return RouteResult(nodes, edges, t, dist, sun, full_sun, rain, full_rain, expanded, cost)


def compare(model: ExposureModel, origin: int, dest: int, start: datetime, w_sun: float,
            w_rain: float = 0.0, **kw) -> tuple[RouteResult, RouteResult]:
    """(fastest route, ContextRoute) for the side-by-side stats the UI shows."""
    return (route(model, origin, dest, start, **kw),
            route(model, origin, dest, start, w_sun=w_sun, w_rain=w_rain, **kw))
