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

A* heuristic: h(n) = k * w_t * straight_line(n, goal) / v. Every edge costs at
least w_t * tau_e whatever the weights and the time, so h is consistent for all
searches, and A* settles exactly the labels Dijkstra would, just fewer of them.
k = HEURISTIC_SLACK < 1 because OSM edge lengths can be slightly shorter than
the projected straight line between their ends.

The UI's sun-avoidance slider does not set w_s: shade_options() finds every
time/sun trade-off a trip offers, and pick() chooses among them, so the route
changes as gradually as the campus allows.
"""
from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from .exposure import ExposureModel

# Edge length / projected straight line is >= 0.9975 on the campus graph.
HEURISTIC_SLACK = 0.99
# shade_options(): consider routes up to 50 % costlier than the quickest, and only
# count a route as a new option if it cuts the sun by 2 % of the quickest route's.
MAX_DETOUR = 0.5
SUN_STEP = 0.02


class NoRouteError(Exception):
    pass


@dataclass
class RouteResult:
    nodes: list[int]
    edges: list[int]                
    seconds: float                 
    distance_m: float
    sun_seconds: float            
    full_sun_seconds: float      
    rain_seconds: float          
    full_rain_seconds: float    
    expanded: int = 0         
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
    heuristic = _heuristic(model, dest, w_time if use_astar else 0.0)
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


def _heuristic(model: ExposureModel, dest: int, w_time: float = 1.0):
    """A* lower bound on the remaining cost: straight-line walking time to `dest`."""
    nodes = model.graph.nodes
    gx, gy = nodes[dest]["x"], nodes[dest]["y"]
    scale = HEURISTIC_SLACK * w_time / model.speed
    return lambda n: scale * math.hypot(nodes[n]["x"] - gx, nodes[n]["y"] - gy)


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


# --- shade options: the time/sun trade-off of one trip -----------------------------

def shade_options(model: ExposureModel, origin: int, dest: int, start: datetime,
                  w_rain: float = 0.0) -> list[RouteResult]:
    """Every sensible trade of walking for shade on this trip, quickest first, shadiest last.

    The Pareto set of routes over two criteria: cost c = tau + w_r * W (time, plus
    rain if weighted) and sun exposure S. Each option costs more and gets less sun
    than the one before. A weighted sum c + w_s * S only ever finds the options on
    the convex hull of this set, so sweeping w_s jumps over the ones in between;
    this search finds them all.

    Bicriteria label-setting (Martins' algorithm) with A* keys: a node can hold
    several labels, each with its own arrival time. Labels at one node pop in cost
    order, so a label is kept only if it has less sun than every label kept there
    before it. Two limits keep the set small and useful: options cost at most
    MAX_DETOUR more than the quickest, and must cut the sun by at least
    SUN_STEP of the quickest route's sun (and 1 sun-second) to count as different.
    """
    quickest = route(model, origin, dest, start, w_rain=w_rain)
    cap = quickest.cost * (1 + MAX_DETOUR)
    step = max(1.0, SUN_STEP * quickest.sun_seconds)
    h = _heuristic(model, dest)

    least_sun: dict[int, float] = {}            # node -> sun of the last label kept there
    labels: list[tuple[int, int]] = []          # (parent label, edge idx) of each kept label
    found: list[tuple[int, float]] = []         # (label, cost) of the options, in cost order
    counter = itertools.count()
    heap = [(h(origin), 0.0, 0.0, 0.0, next(counter), origin, -1, -1)]

    while heap:
        _, cost, sun, elapsed, _, u, parent, edge = heapq.heappop(heap)
        # Dominated by a label kept here, or by an option already found (which is cheaper).
        if sun > least_sun.get(u, math.inf) - step or sun > least_sun.get(dest, math.inf) - step:
            continue
        least_sun[u] = sun
        labels.append((parent, edge))
        if u == dest:
            found.append((len(labels) - 1, cost))
            continue
        t_u = start + timedelta(seconds=elapsed)
        for v, parallel in model.graph[u].items():
            for key in parallel:
                ei = model.edge_index[(u, v, key)]
                tau = model.traversal_seconds(ei)
                c = cost + tau + (w_rain * model.rain_seconds(ei, t_u) if w_rain else 0.0)
                if c + h(v) > cap:
                    continue
                s = sun + model.sun_seconds(ei, t_u)
                if s <= least_sun.get(v, math.inf) - step:
                    heapq.heappush(heap, (c + h(v), c, s, elapsed + tau, next(counter), v, len(labels) - 1, ei))

    options = []
    for label, cost in found:
        edges = []
        while labels[label][0] != -1:
            label, ei = labels[label]
            edges.append(ei)
        edges.reverse()
        nodes = [origin] + [model.edges[ei].v for ei in edges]
        options.append(_summarise(model, nodes, edges, start, cost, len(labels)))
    return options


def pick(options: list[RouteResult], avoidance: float) -> RouteResult:
    """Quickest option that avoids at least `avoidance` (0-1) of the sun the options can avoid.

    0 is the quickest option, 1 the shadiest, 0.5 the quickest one that cuts at
    least half of the sun between those two.
    """
    most, least = options[0].sun_seconds, options[-1].sun_seconds
    target = most - avoidance * (most - least)
    return next(r for r in options if r.sun_seconds <= target + 1e-9)
