"""Sun and rain exposure along walkway edges.

Pipeline for one edge e entered at time t_e (walking speed v, length d):

    tau_e = d / v                                    traversal time (s)
    f(e, t) = length(e ∩ shadow(t)) / length(e)      fraction of the edge in shade
    I(t)    = direct_radiation(t) / 1000 W/m²        relative direct-sun intensity
              (clear-sky fallback: max(0, sin(theta(t))))
    S_e     = ∫ from t_e to t_e+tau_e of I(t) (1 - f) dt        (sun-seconds)

    g(e)    = share of e under a roof (in a building or a covered/indoor way)
    R(t)    = min(1, rain(t) / 4 mm/h)               relative rain intensity
    W_e     = ∫ from t_e to t_e+tau_e of R(t) (1 - g) dt        (rain-seconds)

Shade only blocks the direct beam, which is why I(t) is the forecast direct
radiation rather than total sunlight. The integrals use the trapezoid rule over
the traversal. Shadows move slowly, so the shade fraction is computed on a
coarse time grid (`slice_seconds`, default 15 min) and the nearest slice is used.
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
from .weather import DayWeather, rain_intensity

WALK_SPEED_MPS = 1.4
SAMPLE_SPACING_M = 1.5  # spacing of shade sample points along an edge
CLEAR_SKY_DIRECT_WM2 = 1000.0  # direct radiation that counts as intensity 1
MAX_CACHED_SLICES = 192  # shade-fraction slices kept (two days of 15-min slices)
# OSM tag values on a walk edge that mean the walkway is roofed.
SHELTER_TAGS = {"tunnel": {"building_passage", "yes"}, "covered": {"yes", "arcade", "colonnade"},
                "indoor": {"yes", "corridor"}, "highway": {"corridor"}}


@dataclass(frozen=True)
class EdgeRef:
    u: int
    v: int
    key: int
    length: float  # metres


class SunSchedule:
    """Sun position, sun intensity and rain over a day, at 1-minute resolution.

    With `weather`, intensity is the forecast direct radiation and rain is the
    forecast precipitation. Without it (no data, or a forced clear sky), the
    sky is clear and dry: intensity max(0, sin(theta)), no rain.
    """

    def __init__(self, lat: float, lon: float, day: datetime, weather: DayWeather | None = None):
        midnight = day.replace(hour=0, minute=0, second=0, microsecond=0)
        self.t0 = midnight
        # Wall-clock minutes (the arithmetic _minutes() inverts), so DST-change days line up too.
        times = pd.to_datetime([midnight + timedelta(minutes=i) for i in range(24 * 60 + 1)], utc=True)
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
        # Plain linear interpolation between whole minutes: called for every edge the
        # router looks at, where np.interp's per-call overhead dominated the search.
        m = min(max(self._minutes(when), 0.0), len(values) - 1.0)
        i = min(int(m), len(values) - 2)
        return float(values[i] + (values[i + 1] - values[i]) * (m - i))

    def intensity(self, when: datetime) -> float:
        """Relative direct-sun intensity at `when`, linearly interpolated between minutes."""
        return self._interp(self._intensity, when)

    def rain(self, when: datetime) -> float:
        """Relative rain intensity R at `when` (0 dry .. 1 moderate rain or heavier)."""
        return self._interp(self._rain, when)

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

        self.edges: list[EdgeRef] = []
        self.edge_index: dict[tuple[int, int, int], int] = {}
        lines, edge_attrs = [], []
        for u, v, k, a in data.graph.edges(keys=True, data=True):
            geom = a.get("geometry")
            if geom is None:
                nu, nv = data.graph.nodes[u], data.graph.nodes[v]
                geom = LineString([(nu["x"], nu["y"]), (nv["x"], nv["y"])])
            self.edge_index[(u, v, k)] = len(self.edges)
            self.edges.append(EdgeRef(u, v, k, float(a["length"])))
            lines.append(geom)
            edge_attrs.append(a)
        self._lines = np.array(lines, dtype=object)
        self._geom_len = shapely.length(self._lines)
        self._build_samples()
        self.shelter = self._shelter_fractions(data, edge_attrs)

    def _build_samples(self) -> None:
        """Sample points along every edge: shade fraction = share of sample points in shadow."""
        counts = np.maximum(2, np.ceil(self._geom_len / SAMPLE_SPACING_M)).astype(int)
        self._sample_edge = np.repeat(np.arange(len(self._lines)), counts)
        within = np.arange(counts.sum()) - np.repeat(np.cumsum(counts) - counts, counts)
        frac = (within + 0.5) / np.repeat(counts, counts)
        self._samples = shapely.line_interpolate_point(self._lines[self._sample_edge], frac, normalized=True)
        self._sample_counts = counts
        # The samples never move, so index them once; each time slice then queries
        # this tree with its few thousand shadow pieces.
        self._sample_tree = shapely.STRtree(self._samples)

    def _shelter_fractions(self, data: CampusData, edge_attrs: list[dict]) -> np.ndarray:
        """g(e): share of each edge's sample points inside a building, or 1 for roofed walkways."""
        inside = np.zeros(len(self._samples))
        if len(data.buildings):
            footprints = np.asarray(data.buildings.geometry, dtype=object)
            hit = shapely.STRtree(footprints).query(self._samples, predicate="intersects")[0]
            inside[np.unique(hit)] = 1.0
        frac = np.bincount(self._sample_edge, weights=inside, minlength=len(self.edges)) / self._sample_counts
        for i, a in enumerate(edge_attrs):
            if any(_has_tag(a.get(tag), values) for tag, values in SHELTER_TAGS.items()):
                frac[i] = 1.0
        return frac

    def with_sun(self, sun: SunSchedule) -> "ExposureModel":
        """Cheap copy using another SunSchedule (e.g. another date or weather).

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

    def slice_index(self, when: datetime) -> int:
        """Which time slice `when` falls in; every time in one slice has the same shadows."""
        return int(round(when.timestamp() / self.slice_seconds))

    def _position_for_slice(self, when: datetime) -> SunPosition:
        slice_time = datetime.fromtimestamp(self.slice_index(when) * self.slice_seconds, tz=when.tzinfo)
        return self.sun.position(slice_time)

    def shadow_at(self, when: datetime):
        """Exact combined shadow polygon (metric CRS) for the time slice nearest `when`.

        Slow (a union of thousands of pieces); for drawing, use shadow_pieces_at().
        """
        return self._caster.shadow(self._position_for_slice(when))

    def shadow_pieces_at(self, when: datetime) -> np.ndarray:
        """Overlapping polygons whose union is the shadow at the slice nearest `when`.

        Exteriors run counter-clockwise and holes clockwise, so drawn as one path with
        the nonzero fill rule they look exactly like the union, without computing it.
        """
        return shapely.orient_polygons(self._caster.pieces(self._position_for_slice(when)))

    def shade_fractions(self, when: datetime) -> np.ndarray:
        """f(e) for every edge at the time slice nearest `when` (1 = fully shaded)."""
        key = self.slice_index(when)
        cached = self._shade_cache.get(key)
        if cached is not None:
            return cached
        pieces = self._caster.pieces(self._position_for_slice(when))
        if len(pieces) == 0:
            frac = np.zeros(len(self.edges))
        else:
            hit = self._sample_tree.query(pieces, predicate="intersects")[1]
            shaded = np.zeros(len(self._samples))
            shaded[np.unique(hit)] = 1.0
            frac = np.bincount(self._sample_edge, weights=shaded, minlength=len(self.edges)) / self._sample_counts
        _remember(self._shade_cache, key, frac)
        return frac

    # --- exposure ----------------------------------------------------------

    def traversal_seconds(self, edge: int) -> float:
        return self.edges[edge].length / self.speed

    def _trapezoid(self, edge: int, enter: datetime, rate) -> float:
        """Trapezoid integral of rate(t) over the traversal of `edge` starting at `enter`."""
        tau = self.traversal_seconds(edge)
        return tau * 0.5 * (rate(enter) + rate(enter + timedelta(seconds=tau)))

    def sun_seconds(self, edge: int, enter: datetime) -> float:
        """S_e: integral of I(t)(1-f) over the traversal starting at `enter`."""
        return (1.0 - self.shade_fractions(enter)[edge]) * self.full_sun_seconds(edge, enter)

    def full_sun_seconds(self, edge: int, enter: datetime) -> float:
        """Same integral with no shade (f=0): the sun the edge would give in the open."""
        return self._trapezoid(edge, enter, self.sun.intensity)

    def rain_seconds(self, edge: int, enter: datetime) -> float:
        """W_e: integral of R(t)(1-g) over the traversal starting at `enter`."""
        return (1.0 - self.shelter[edge]) * self.full_rain_seconds(edge, enter)

    def full_rain_seconds(self, edge: int, enter: datetime) -> float:
        """Same integral with no shelter (g=0): the rain the edge would give in the open."""
        return self._trapezoid(edge, enter, self.sun.rain)


def _remember(cache: dict, key, value) -> None:
    """Store a slice; the caches are shared by every with_sun() copy, so start over when full."""
    if len(cache) >= MAX_CACHED_SLICES:
        cache.clear()
    cache[key] = value


def _has_tag(value, accepted: set[str]) -> bool:
    """OSM tag check. Merged edges hold several values, which GraphML stores as "['a', 'b']"."""
    if value is None:
        return False
    if isinstance(value, list):
        return any(str(v) in accepted for v in value)
    text = str(value)
    if text.startswith("["):
        return any(f"'{v}'" in text for v in accepted)
    return text in accepted
