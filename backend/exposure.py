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

import copy
import math
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import LineString

from .data import CampusData, building_list, tree_list
from .shadow import ShadowCaster
from .sun import SunPosition, sun_positions

WALK_SPEED_MPS = 1.4
SAMPLE_SPACING_M = 1.5  # spacing of shade sample points along an edge


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
        self._caster = ShadowCaster(building_list(data), tree_list(data))
        self._shade_cache: dict[int, np.ndarray] = {}
        self._shadow_cache: dict[int, shapely.Geometry] = {}

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
        self._build_samples()

    def _build_samples(self) -> None:
        """Sample points along every edge: shade fraction = share of sample points in shadow."""
        counts = np.maximum(2, np.ceil(self._geom_len / SAMPLE_SPACING_M)).astype(int)
        self._sample_edge = np.repeat(np.arange(len(self._lines)), counts)
        within = np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)
        frac = (within + 0.5) / np.repeat(counts, counts)
        self._samples = shapely.line_interpolate_point(self._lines[self._sample_edge], frac, normalized=True)
        self._sample_counts = counts

    def with_sun(self, sun: SunSchedule) -> "ExposureModel":
        """Cheap copy using another SunSchedule (e.g. other date/cloud cover).

        Shares the edge tables and the shade cache: the shadow at a given instant
        depends only on that instant, so cached slices stay valid across schedules.
        """
        other = copy.copy(self)
        other.sun = sun
        return other

    def edge_line(self, edge: int) -> LineString:
        """Edge geometry (metric CRS), oriented from edge.u to edge.v."""
        line = self._lines[edge]
        ref = self.edges[edge]
        nu = self.graph.nodes[ref.u]
        x0, y0 = line.coords[0]
        if math.hypot(x0 - nu["x"], y0 - nu["y"]) > math.hypot(line.coords[-1][0] - nu["x"], line.coords[-1][1] - nu["y"]):
            line = LineString(list(line.coords)[::-1])
        return line

    # --- shade -------------------------------------------------------------

    def _slice(self, when: datetime) -> int:
        return int(round(when.timestamp() / self.slice_seconds))

    def _position_for_slice(self, when: datetime) -> SunPosition:
        slice_time = datetime.fromtimestamp(self._slice(when) * self.slice_seconds, tz=when.tzinfo)
        return self.sun.position(slice_time)

    def shadow_at(self, when: datetime):
        """Combined building shadow polygon (metric CRS) for the time slice nearest `when`."""
        key = self._slice(when)
        shadow = self._shadow_cache.get(key)
        if shadow is None:
            shadow = self._caster.shadow(self._position_for_slice(when))
            self._shadow_cache[key] = shadow
        return shadow

    def shade_fractions(self, when: datetime) -> np.ndarray:
        """f(e) for every edge at the time slice nearest `when` (1 = fully shaded)."""
        key = self._slice(when)
        cached = self._shade_cache.get(key)
        if cached is not None:
            return cached
        pieces = self._caster.pieces(self._position_for_slice(when))
        if len(pieces) == 0:
            frac = np.zeros(len(self.edges))
        else:
            hit = shapely.STRtree(pieces).query(self._samples, predicate="intersects")[0]
            shaded = np.zeros(len(self._samples))
            shaded[np.unique(hit)] = 1.0
            frac = np.bincount(self._sample_edge, weights=shaded, minlength=len(self.edges)) / self._sample_counts
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
