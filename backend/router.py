"""Walking router: A* for the fastest route, and a bicriteria (time, sun) search for every
sensible trade of extra walking for shade. Edge costs depend on when the edge is entered."""
from __future__ import annotations

import heapq
import itertools
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

from .exposure import WALK_SPEED_MPS, ExposureModel

HEURISTIC_SLACK = 0.99  # edge length / straight line is >= 0.9975 on the campus graph, so A* stays exact
MAX_DETOUR = 0.5  # shade options cost at most 50 % more than the quickest route
SUN_STEP = 0.02  # each option must cut at least 2 % of the quickest route's sun


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
    cost: float

    @property
    def sun_percent(self) -> float:
        return 100.0 * self.sun_seconds / self.full_sun_seconds if self.full_sun_seconds > 0 else 0.0

    @property
    def rain_percent(self) -> float:
        return 100.0 * self.rain_seconds / self.full_rain_seconds if self.full_rain_seconds > 0 else 0.0


def route(model: ExposureModel, origin: int, dest: int, start: datetime, w_rain: float = 0.0) -> RouteResult:
    """A* from `origin` to `dest` leaving at `start`; edge cost = walking seconds + w_rain * rain-seconds."""
    g = model.graph
    heuristic = _heuristic(model, dest)
    counter = itertools.count()  # tie-breaker so the heap never compares nodes
    best: dict[int, float] = {origin: 0.0}
    came: dict[int, tuple[int, int]] = {}      # node -> (previous node, edge index)
    elapsed: dict[int, float] = {origin: 0.0}  # seconds walked when reaching the node
    heap = [(heuristic(origin), 0.0, next(counter), origin)]

    while heap:
        _, cost_u, _, u = heapq.heappop(heap)
        if cost_u != best.get(u):
            continue
        if u == dest:
            break
        t_u = start + timedelta(seconds=elapsed[u])
        for v, parallel in g[u].items():
            for key in parallel:
                ei = model.edge_index[(u, v, key)]
                tau = model.traversal_seconds(ei)
                c = best[u] + tau
                if w_rain:
                    c += w_rain * model.rain_seconds(ei, t_u)
                if c < best.get(v, math.inf):
                    best[v] = c
                    came[v] = (u, ei)
                    elapsed[v] = elapsed[u] + tau
                    heapq.heappush(heap, (c + heuristic(v), c, next(counter), v))

    if dest not in best:
        raise NoRouteError(f"no route from {origin} to {dest}")

    nodes, edges = [dest], []
    while nodes[-1] != origin:
        prev, ei = came[nodes[-1]]
        nodes.append(prev)
        edges.append(ei)
    nodes.reverse()
    edges.reverse()
    return _summarise(model, nodes, edges, start, best[dest])


def _heuristic(model: ExposureModel, dest: int):
    """Lower bound on the remaining cost: straight-line walking time to `dest`."""
    nodes = model.graph.nodes
    gx, gy = nodes[dest]["x"], nodes[dest]["y"]
    scale = HEURISTIC_SLACK / WALK_SPEED_MPS
    return lambda n: scale * math.hypot(nodes[n]["x"] - gx, nodes[n]["y"] - gy)


def _summarise(model: ExposureModel, nodes: list[int], edges: list[int], start: datetime,
               cost: float) -> RouteResult:
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
    return RouteResult(nodes, edges, t, dist, sun, full_sun, rain, full_rain, cost)


def shade_options(model: ExposureModel, origin: int, dest: int, start: datetime,
                  w_rain: float = 0.0) -> list[RouteResult]:
    """Pareto set of (cost, sun) routes, quickest first: each option costs more and gets less sun.

    Martins' label-setting algorithm with A* keys: a node keeps several labels, each with its own
    arrival time, and a label is kept only if it has less sun than every label kept there before it.
    """
    quickest = route(model, origin, dest, start, w_rain=w_rain)
    cap = quickest.cost * (1 + MAX_DETOUR)
    step = max(1.0, SUN_STEP * quickest.sun_seconds)
    h = _heuristic(model, dest)

    least_sun: dict[int, float] = {}    # node -> sun of the last label kept there
    labels: list[tuple[int, int]] = []  # (parent label, edge index) of each kept label
    found: list[tuple[int, float]] = []  # (label, cost) of the options, in cost order
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
        options.append(_summarise(model, nodes, edges, start, cost))
    return options


def pick(options: list[RouteResult], avoidance: float) -> RouteResult:
    """Quickest option that avoids at least `avoidance` (0-1) of the sun the options can avoid."""
    most, least = options[0].sun_seconds, options[-1].sun_seconds
    target = most - avoidance * (most - least)
    return next(r for r in options if r.sun_seconds <= target + 1e-9)
