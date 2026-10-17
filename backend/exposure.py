"""Sun exposure along walkway edges.

Pipeline for one edge e entered at time t_e (walking speed v, length d):

    tau_e = d / v                                    traversal time (s)
    f(e, t) = length(e ∩ shadow(t)) / length(e)      fraction of the edge in shade
    I(t)    = max(0, sin(theta(t))) * cloud factor   relative sun intensity
    S_e     = ∫ from t_e to t_e+tau_e of I(t) (1 - f) dt        (sun-seconds)

The integral is evaluated with the trapezoid rule over the traversal. Shadows
move slowly, so the shade fraction is computed on a coarse time grid
(`slice_seconds`, default 15 min) and the nearest slice is used.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import networkx as nx
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import LineString

from .data import CampusData, building_list
from .shadow import shadow_union
from .sun import SunPosition, sun_positions

WALK_SPEED_MPS = 1.4


def cloud_factor(cloud_cover: float) -> float:
    """Kasten-Czeplak: fraction of clear-sky irradiance reaching the ground, 1 - 0.75 c^3.4."""
    return 1.0 - 0.75 * cloud_cover ** 3.4


@dataclass(frozen=True)
class EdgeRef:
    u: int
    v: int
    key: int
    length: float  # metres


class SunSchedule:
    """Sun position and intensity over a day, precomputed at 1-minute resolution."""

    def __init__(self, lat: float, lon: float, day: datetime, cloud_cover: float = 0.0):
        midnight = day.replace(hour=0, minute=0, second=0, microsecond=0)
        self.t0 = midnight
        times = pd.date_range(midnight, periods=24 * 60 + 1, freq="min")
        pos = sun_positions(lat, lon, times)
        self.elevation = pos["elevation"].to_numpy()
        self.azimuth = pos["azimuth"].to_numpy()
        self.cloud = cloud_factor(cloud_cover)
        self._intensity = np.maximum(0.0, np.sin(np.radians(self.elevation))) * self.cloud

    def _minutes(self, when: datetime) -> float:
        return (when - self.t0).total_seconds() / 60.0

    def intensity(self, when: datetime) -> float:
        """Relative intensity at `when`, linearly interpolated between minutes."""
        return float(np.interp(self._minutes(when), np.arange(len(self._intensity)), self._intensity))

    def position(self, when: datetime) -> SunPosition:
        i = int(round(self._minutes(when)))
        i = min(max(i, 0), len(self.elevation) - 1)
        return SunPosition(float(self.elevation[i]), float(self.azimuth[i]))


class ExposureModel:
    """Edge shade fractions and sun-exposure integrals for a campus graph."""

    def __init__(self, data: CampusData, sun: SunSchedule, slice_seconds: int = 900,
                 speed: float = WALK_SPEED_MPS):
        self.graph = data.graph
        self.sun = sun
        self.slice_seconds = slice_seconds
        self.speed = speed
        self._buildings = building_list(data)
        self._shade_cache: dict[int, np.ndarray] = {}

        self.edges: list[EdgeRef] = []
        self.edge_index: dict[tuple[int, int, int], int] = {}
        lines = []
        for u, v, k, a in data.graph.edges(keys=True, data=True):
            geom = a.get("geometry")
            if geom is None:
                nu, nv = data.graph.nodes[u], data.graph.nodes[v]
                geom = LineString([(nu["x"], nu["y"]), (nv["x"], nv["y"])])
            self.edge_index[(u, v, k)] = len(self.edges)
            self.edges.append(EdgeRef(u, v, k, float(a["length"])))
            lines.append(geom)
        self._lines = np.array(lines, dtype=object)
        self._geom_len = shapely.length(self._lines)
        shapely.prepare(self._lines)

    # --- shade -------------------------------------------------------------

    def _slice(self, when: datetime) -> int:
        return int(round(when.timestamp() / self.slice_seconds))

    def shade_fractions(self, when: datetime) -> np.ndarray:
        """f(e) for every edge at the time slice nearest `when` (1 = fully shaded)."""
        key = self._slice(when)
        cached = self._shade_cache.get(key)
        if cached is not None:
            return cached
        slice_time = datetime.fromtimestamp(key * self.slice_seconds, tz=when.tzinfo)
        sun = self.sun.position(slice_time)
        shadow = shadow_union(self._buildings, sun)
        if shadow.is_empty:
            frac = np.zeros(len(self.edges))
        else:
            inside = shapely.length(shapely.intersection(self._lines, shadow))
            frac = np.clip(inside / np.where(self._geom_len > 0, self._geom_len, 1.0), 0.0, 1.0)
        self._shade_cache[key] = frac
        return frac

    # --- exposure ----------------------------------------------------------

    def traversal_seconds(self, edge: int) -> float:
        return self.edges[edge].length / self.speed

    def sun_seconds(self, edge: int, enter: datetime) -> float:
        """S_e: trapezoid integral of I(t)(1-f) over the traversal starting at `enter`."""
        tau = self.traversal_seconds(edge)
        unshaded = 1.0 - self.shade_fractions(enter)[edge]
        i0 = self.sun.intensity(enter)
        i1 = self.sun.intensity(enter + timedelta(seconds=tau))
        return tau * unshaded * 0.5 * (i0 + i1)

    def full_sun_seconds(self, edge: int, enter: datetime) -> float:
        """Same integral with no shade (f=0): the sun the edge would give in the open."""
        tau = self.traversal_seconds(edge)
        i0 = self.sun.intensity(enter)
        i1 = self.sun.intensity(enter + timedelta(seconds=tau))
        return tau * 0.5 * (i0 + i1)
