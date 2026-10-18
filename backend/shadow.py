"""Building and tree shadows on flat ground.

All geometry is in a local metric frame: x = east (m), y = north (m).

Math
----
A point at height h under a sun at elevation theta and azimuth alpha casts its
shadow a distance  L = h / tan(theta)  on the ground, in the direction opposite
the sun, i.e. the offset vector is

    (dx, dy) = (-L sin(alpha), -L cos(alpha)).

A building is a prism: footprint polygon extruded to height h. Its shadow is
the footprint swept along that offset. Sweeping one edge gives a parallelogram,
so shadow = union(footprint, one parallelogram per edge); for a convex footprint
that is just the convex hull of the footprint and its shifted copy.
"""
from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import shapely
from shapely.geometry import Point, Polygon
from shapely.geometry.base import BaseGeometry

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


def tree_crown(x: float, y: float) -> Polygon:
    """Crown footprint of a tree at (x, y): a 12-sided disk."""
    return Point(x, y).buffer(TREE_CROWN_RADIUS_M, quad_segs=3)


class ShadowCaster:
    """Fast repeated shadow computation for a fixed set of buildings.

    Convex footprints (most buildings): the swept shadow is exactly the convex
    hull of the footprint and its copy shifted by the shadow offset, built for
    all buildings in one vectorised call.
    Concave footprints (courtyards, L/U shapes): hulls would wrongly fill the
    gaps, so they use the exact per-edge sweep (footprint + one parallelogram
    per edge). pieces() returns all of these shapes as they are; shadow() merges them
    with a single union.

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
            sweeps = shapely.polygons(ring)
            pieces.append(self._ccv_fp)
            # An edge parallel to the sun (or a 0 m building) sweeps no area; drop those.
            pieces.append(sweeps[shapely.area(sweeps) > 0])

        return np.concatenate(pieces)

