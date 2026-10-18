"""Sun and rain exposure of walkway edges: sun-seconds S_e = ∫ I(t)(1 - f) dt and
rain-seconds W_e = ∫ R(t)(1 - g) dt over the time it takes to walk the edge."""
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
from .weather import DayWeather, rain_intensity

WALK_SPEED_MPS = 1.4
SAMPLE_SPACING_M = 1.5  # shade fraction f = share of sample points this far apart that are in shadow
SLICE_SECONDS = 900  # shadows move slowly, so they are computed every 15 minutes
CLEAR_SKY_DIRECT_WM2 = 1000.0  # direct radiation that counts as intensity 1
MAX_CACHED_SLICES = 192  # two days of shade-fraction slices
# OSM tag values that mark a walkway as roofed (shelter g = 1).
SHELTER_TAGS = {"tunnel": {"building_passage", "yes"}, "covered": {"yes", "arcade", "colonnade"},
                "indoor": {"yes", "corridor"}, "highway": {"corridor"}}


@dataclass(frozen=True)
class EdgeRef:
    u: int
    v: int
    length: float  # metres


class SunSchedule:
    """Sun position, intensity I and rain R for one day at 1-minute resolution.
    Without weather the sky is clear and dry: I = max(0, sin(elevation)), R = 0."""

    def __init__(self, lat: float, lon: float, day: datetime, weather: DayWeather | None = None):
        self.t0 = day.replace(hour=0, minute=0, second=0, microsecond=0)
        # Wall-clock minutes (as _minutes() counts them), so DST-change days line up too.
        times = pd.to_datetime([self.t0 + timedelta(minutes=i) for i in range(24 * 60 + 1)], utc=True)
        pos = sun_positions(lat, lon, times)
        self.elevation = pos["elevation"].to_numpy()
        self.azimuth = pos["azimuth"].to_numpy()
        self.weather = weather
        if weather is None:
            self._intensity = np.maximum(0.0, np.sin(np.radians(self.elevation)))
            self._rain = np.zeros(len(times))
        else:
            self._intensity = weather.direct / CLEAR_SKY_DIRECT_WM2
            self._rain = rain_intensity(weather.rain)

    def _minutes(self, when: datetime) -> float:
        return (when - self.t0).total_seconds() / 60.0

    def _interp(self, values: np.ndarray, when: datetime) -> float:
        # Hand-rolled linear interpolation: np.interp's per-call overhead dominated the search.
        m = min(max(self._minutes(when), 0.0), len(values) - 1.0)
        i = min(int(m), len(values) - 2)
        return float(values[i] + (values[i + 1] - values[i]) * (m - i))

    def intensity(self, when: datetime) -> float:
        return self._interp(self._intensity, when)

    def rain(self, when: datetime) -> float:
        return self._interp(self._rain, when)

    def position(self, when: datetime) -> SunPosition:
        i = min(max(int(round(self._minutes(when))), 0), len(self.elevation) - 1)
        return SunPosition(float(self.elevation[i]), float(self.azimuth[i]))


class ExposureModel:
    """Per-edge shade fraction f(t), shelter g and exposure integrals for the campus walk graph."""

    def __init__(self, data: CampusData, sun: SunSchedule):
        self.graph = data.graph
        self.sun = sun
        self._caster = ShadowCaster(building_list(data), tree_list(data))
        self._shade_cache: dict[int, np.ndarray] = {}

        self.edges: list[EdgeRef] = []
        self.edge_index: dict[tuple[int, int, int], int] = {}
        lines, edge_attrs = [], []
        for u, v, k, a in data.graph.edges(keys=True, data=True):
            geom = a.get("geometry")
            if geom is None:
                nu, nv = data.graph.nodes[u], data.graph.nodes[v]
                geom = LineString([(nu["x"], nu["y"]), (nv["x"], nv["y"])])
            self.edge_index[(u, v, k)] = len(self.edges)
            self.edges.append(EdgeRef(u, v, float(a["length"])))
            lines.append(geom)
            edge_attrs.append(a)
        self._lines = np.array(lines, dtype=object)

        # Sample points along every edge (at least 2), indexed once for the shadow queries.
        counts = np.maximum(2, np.ceil(shapely.length(self._lines) / SAMPLE_SPACING_M)).astype(int)
        self._sample_edge = np.repeat(np.arange(len(self._lines)), counts)
        within = np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)
        frac = (within + 0.5) / np.repeat(counts, counts)
        self._samples = shapely.line_interpolate_point(self._lines[self._sample_edge], frac, normalized=True)
        self._sample_counts = counts
        self._sample_tree = shapely.STRtree(self._samples)

        # Shelter g: share of sample points inside a building, or 1 for a roofed walkway.
        inside = np.zeros(len(self._samples))
        if len(data.buildings):
            footprints = np.asarray(data.buildings.geometry, dtype=object)
            inside[np.unique(shapely.STRtree(footprints).query(self._samples, predicate="intersects")[0])] = 1.0
        self.shelter = self._per_edge(inside)
        for i, a in enumerate(edge_attrs):
            if any(_has_tag(a.get(tag), values) for tag, values in SHELTER_TAGS.items()):
                self.shelter[i] = 1.0

    def _per_edge(self, per_sample: np.ndarray) -> np.ndarray:
        """Average a 0/1 value over each edge's sample points."""
        return np.bincount(self._sample_edge, weights=per_sample, minlength=len(self.edges)) / self._sample_counts

    def with_sun(self, sun: SunSchedule) -> ExposureModel:
        """Cheap copy for another date or weather; shares the edge tables and the shade cache."""
        other = copy.copy(self)
        other.sun = sun
        return other

    def edge_line(self, edge: int) -> LineString:
        """Edge geometry (metric CRS), oriented from edge.u to edge.v."""
        line = self._lines[edge]
        nu = self.graph.nodes[self.edges[edge].u]
        (x0, y0), (x1, y1) = line.coords[0], line.coords[-1]
        if math.hypot(x0 - nu["x"], y0 - nu["y"]) > math.hypot(x1 - nu["x"], y1 - nu["y"]):
            line = LineString(list(line.coords)[::-1])
        return line

    def slice_index(self, when: datetime) -> int:
        """The 15-minute time slice nearest `when`; every time in one slice has the same shadows."""
        return int(round(when.timestamp() / SLICE_SECONDS))

    def _slice_pieces(self, when: datetime) -> np.ndarray:
        slice_time = datetime.fromtimestamp(self.slice_index(when) * SLICE_SECONDS, tz=when.tzinfo)
        return self._caster.pieces(self.sun.position(slice_time))

    def shadow_pieces_at(self, when: datetime) -> np.ndarray:
        """Shadow pieces oriented so that, drawn with the nonzero fill rule, they look like their union."""
        return shapely.orient_polygons(self._slice_pieces(when))

    def shade_fractions(self, when: datetime) -> np.ndarray:
        """f(e) for every edge at the slice nearest `when` (1 = fully shaded)."""
        key = self.slice_index(when)
        frac = self._shade_cache.get(key)
        if frac is None:
            pieces = self._slice_pieces(when)
            shaded = np.zeros(len(self._samples))
            if len(pieces):
                shaded[np.unique(self._sample_tree.query(pieces, predicate="intersects")[1])] = 1.0
            frac = self._per_edge(shaded)
            if len(self._shade_cache) >= MAX_CACHED_SLICES:
                self._shade_cache.clear()
            self._shade_cache[key] = frac
        return frac

    def traversal_seconds(self, edge: int) -> float:
        return self.edges[edge].length / WALK_SPEED_MPS

    def _trapezoid(self, edge: int, enter: datetime, rate) -> float:
        """Trapezoid-rule integral of rate(t) over the walk along `edge` starting at `enter`."""
        tau = self.traversal_seconds(edge)
        return tau * 0.5 * (rate(enter) + rate(enter + timedelta(seconds=tau)))

    def sun_seconds(self, edge: int, enter: datetime) -> float:
        return (1.0 - self.shade_fractions(enter)[edge]) * self.full_sun_seconds(edge, enter)

    def full_sun_seconds(self, edge: int, enter: datetime) -> float:
        return self._trapezoid(edge, enter, self.sun.intensity)

    def rain_seconds(self, edge: int, enter: datetime) -> float:
        return (1.0 - self.shelter[edge]) * self.full_rain_seconds(edge, enter)

    def full_rain_seconds(self, edge: int, enter: datetime) -> float:
        return self._trapezoid(edge, enter, self.sun.rain)


def _has_tag(value, accepted: set[str]) -> bool:
    """OSM tag check; merged edges store several values as text like "['a', 'b']"."""
    if value is None:
        return False
    if isinstance(value, list):
        return any(str(v) in accepted for v in value)
    text = str(value)
    if text.startswith("["):
        return any(f"'{v}'" in text for v in accepted)
    return text in accepted
