"""Building shadows on flat ground.

All geometry is in a local metric frame: x = east (m), y = north (m).

Math
----
A point at height h under a sun at elevation theta and azimuth alpha casts its
shadow a distance  L = h / tan(theta)  on the ground, in the direction opposite
the sun, i.e. the offset vector is

    (dx, dy) = (-L sin(alpha), -L cos(alpha)).

A building is a prism: footprint polygon extruded to height h. Its shadow is
the footprint swept along that offset. Sweeping one edge gives a parallelogram,
so shadow = union(footprint, one parallelogram per edge).
"""
from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import shapely

from shapely.geometry import Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .sun import SunPosition

# Below this elevation the shadow is so long the model stops being meaningful.
MIN_ELEVATION_DEG = 3.0
# Shadow length cap in metres (tan(theta) -> 0 makes L -> infinity).
MAX_SHADOW_LENGTH_M = 300.0

# Footprints at least this close to their convex hull use the fast hull shadow.
CONVEX_AREA_RATIO = 0.98

# Trees carry no size data in our OSM extract, so every tree gets the same crown:
# a canopy disk from TREE_CANOPY_BASE_M up to TREE_HEIGHT_M. The trunk is ignored.
TREE_CROWN_RADIUS_M = 3.0
TREE_CANOPY_BASE_M = 2.0
TREE_HEIGHT_M = 9.0

DEFAULT_HEIGHT_M = 10.0
METRES_PER_LEVEL = 3.0

# Fallback heights (m) by OSM `building=*` value when no height/levels tag exists.
# These are rough assumptions; document them as such.
TYPE_DEFAULT_HEIGHT_M = {
    "garage": 3.0, "garages": 3.0, "shed": 3.0, "roof": 4.0, "carport": 3.0, "parking": 6.0,
    "detached": 8.0, "semidetached_house": 8.0, "house": 8.0, "terrace": 8.0,
    "university": 12.0, "college": 12.0, "dormitory": 15.0, "apartments": 20.0,
    "industrial": 8.0, "retail": 6.0, "commercial": 10.0, "train_station": 8.0,
    "grandstand": 8.0, "stadium": 15.0,
}


def shadow_length(height: float, elevation_deg: float) -> float:
    """L = h / tan(theta), capped at MAX_SHADOW_LENGTH_M."""
    if elevation_deg <= 0.0:
        return MAX_SHADOW_LENGTH_M
    return min(height / math.tan(math.radians(elevation_deg)), MAX_SHADOW_LENGTH_M)


def shadow_offset(height: float, sun: SunPosition) -> tuple[float, float]:
    """Ground displacement (dx east, dy north) of a point at `height`."""
    length = shadow_length(height, sun.elevation)
    alpha = math.radians(sun.azimuth)
    return -length * math.sin(alpha), -length * math.cos(alpha)


def _shadow_parts(footprint: Polygon, height: float, sun: SunPosition) -> list[BaseGeometry]:
    """Footprint plus one swept parallelogram per edge (not yet unioned)."""
    dx, dy = shadow_offset(height, sun)
    parts: list[BaseGeometry] = [footprint]
    for ring in [footprint.exterior, *footprint.interiors]:
        coords = list(ring.coords)
        for (x1, y1), (x2, y2) in zip(coords[:-1], coords[1:]):
            parts.append(Polygon([(x1, y1), (x2, y2), (x2 + dx, y2 + dy), (x1 + dx, y1 + dy)]))
    return parts


def building_shadow(footprint: Polygon, height: float, sun: SunPosition) -> BaseGeometry:
    """Ground shadow of one extruded building (includes the footprint itself)."""
    return unary_union(_shadow_parts(footprint, height, sun))


def tree_crown(x: float, y: float) -> Polygon:
    """Crown footprint of a tree at (x, y): a 12-sided disk."""
    return Point(x, y).buffer(TREE_CROWN_RADIUS_M, quad_segs=3)


def height_from_osm(tags: dict) -> float:
    """Building height in metres from OSM tags: height > levels * 3 m > type default > 10 m."""
    raw = tags.get("height")
    if raw is not None:
        try:
            return float(str(raw).replace("m", "").strip())
        except ValueError:
            pass
    levels = tags.get("building:levels")
    if levels is not None:
        try:
            return float(levels) * METRES_PER_LEVEL
        except ValueError:
            pass
    return TYPE_DEFAULT_HEIGHT_M.get(tags.get("building"), DEFAULT_HEIGHT_M)


class ShadowCaster:
    """Fast repeated shadow computation for a fixed set of buildings.

    Convex footprints (most buildings): the swept shadow is exactly the convex
    hull of the footprint and its copy shifted by the shadow offset, built for
    all buildings in one vectorised call.
    Concave footprints (courtyards, L/U shapes): hulls would wrongly fill the
    gaps, so they use the exact per-edge sweep (footprint + one parallelogram
    per edge). Everything is then merged with a single union.

    Trees are canopy disks floating above the ground: the crown at height
    `base` casts its shadow `base / tan(theta)` away, the crown top
    `top / tan(theta)` away, and the shadow is the hull of the two disks (so
    the ground under a tree is only shaded when the sun is high enough).
    Buildings are the special case base = 0.
    """

    def __init__(self, buildings: Iterable[tuple[Polygon, float]],
                 trees: Iterable[tuple[float, float]] = ()):
        buildings = list(buildings)
        convex = [(fp, 0.0, h) for fp, h in buildings if self._is_convex(fp)]
        concave = [(fp, h) for fp, h in buildings if not self._is_convex(fp)]
        convex += [(tree_crown(x, y), TREE_CANOPY_BASE_M, TREE_HEIGHT_M) for x, y in trees]

        # convex: flat vertex array + owning-building index
        verts, owner = [], []
        for i, (fp, _, _) in enumerate(convex):
            c = np.asarray(fp.exterior.coords)[:-1]
            verts.append(c)
            owner.append(np.full(len(c), i))
        self._cvx_xy = np.concatenate(verts) if verts else np.empty((0, 2))
        self._cvx_owner = np.concatenate(owner) if owner else np.empty(0, dtype=int)
        self._cvx_base = np.array([b for _, b, _ in convex])
        self._cvx_h = np.array([h for _, _, h in convex])

        # concave: footprints + flattened edges
        self._ccv_fp = np.array([fp for fp, _ in concave], dtype=object)
        p1, p2, hs = [], [], []
        for fp, h in concave:
            for ring in [fp.exterior, *fp.interiors]:
                c = np.asarray(ring.coords)
                p1.append(c[:-1])
                p2.append(c[1:])
                hs.append(np.full(len(c) - 1, h))
        self._p1 = np.concatenate(p1) if p1 else np.empty((0, 2))
        self._p2 = np.concatenate(p2) if p2 else np.empty((0, 2))
        self._h = np.concatenate(hs) if hs else np.empty(0)

    @staticmethod
    def _is_convex(fp: Polygon) -> bool:
        return not fp.interiors and fp.area >= CONVEX_AREA_RATIO * fp.convex_hull.area

    def shadow(self, sun: SunPosition) -> BaseGeometry:
        """Union of all building and tree shadows (empty polygon when the sun is below MIN_ELEVATION_DEG)."""
        pieces = self.pieces(sun)
        return Polygon() if len(pieces) == 0 else shapely.union_all(pieces)

    def pieces(self, sun: SunPosition) -> np.ndarray:
        """Overlapping polygons whose union is the shadow (skips the slow union).

        Enough for point-in-shadow tests; use shadow() when you need one clean geometry.
        """
        if sun.elevation < MIN_ELEVATION_DEG:
            return np.empty(0, dtype=object)
        tan_el = math.tan(math.radians(sun.elevation))
        alpha = math.radians(sun.azimuth)
        direction = np.array([-math.sin(alpha), -math.cos(alpha)])
        pieces: list = []

        if len(self._cvx_h):
            low = np.minimum(self._cvx_base / tan_el, MAX_SHADOW_LENGTH_M)
            high = np.minimum(self._cvx_h / tan_el, MAX_SHADOW_LENGTH_M)
            both = np.concatenate([
                self._cvx_xy + low[self._cvx_owner, None] * direction,
                self._cvx_xy + high[self._cvx_owner, None] * direction,
            ])
            idx = np.concatenate([self._cvx_owner, self._cvx_owner])
            order = np.argsort(idx, kind="stable")  # multipoints needs sorted indices
            both, idx = both[order], idx[order]
            pieces.append(shapely.convex_hull(shapely.multipoints(both, indices=idx)))

        if len(self._h):
            length = np.minimum(self._h / tan_el, MAX_SHADOW_LENGTH_M)
            offset = length[:, None] * direction
            ring = np.stack([self._p1, self._p2, self._p2 + offset, self._p1 + offset, self._p1], axis=1)
            pieces.append(self._ccv_fp)
            pieces.append(shapely.polygons(ring))

        return np.concatenate(pieces)


def shadow_union(buildings: Iterable[tuple[Polygon, float]], sun: SunPosition,
                 trees: Iterable[tuple[float, float]] = ()) -> BaseGeometry:
    """Union of all building shadows for one sun position.

    `buildings` is an iterable of (footprint, height_m); `trees` of (x, y) centres. Returns an empty
    polygon when the sun is below MIN_ELEVATION_DEG (the caller handles night
    separately: with no sun there is no sun exposure to accumulate).
    For many calls over the same buildings, build a ShadowCaster once instead.
    """
    return ShadowCaster(buildings, trees).shadow(sun)
