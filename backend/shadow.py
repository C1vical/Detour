"""Building and tree shadows on flat ground (x = east, y = north, in metres). A point at height h
casts its shadow L = h / tan(elevation) away from the sun: offset (-L sin(azimuth), -L cos(azimuth))."""
from __future__ import annotations

import math
from typing import Iterable

import numpy as np
import shapely
from shapely.geometry import Point, Polygon

from .sun import SunPosition

MIN_ELEVATION_DEG = 3.0  # below this the shadows are too long to be meaningful
MAX_SHADOW_LENGTH_M = 300.0  # L -> infinity as tan(theta) -> 0
CONVEX_AREA_RATIO = 0.98  # footprints this close to their convex hull use the fast hull shadow
# OSM trees have no size data, so every tree is a 3 m crown from 2 m to 9 m up (trunk ignored).
TREE_CROWN_RADIUS_M = 3.0
TREE_CANOPY_BASE_M = 2.0
TREE_HEIGHT_M = 9.0


class ShadowCaster:
    """Shadow pieces for a fixed set of buildings (footprint, height) and trees (x, y).

    Convex footprints and tree crowns: the hull of the shape shifted by its base and top shadow
    offsets, all in one vectorised call. Concave footprints: the footprint plus one swept
    parallelogram per wall, since a hull would wrongly fill courtyards.
    """

    def __init__(self, buildings: Iterable[tuple[Polygon, float]], trees: Iterable[tuple[float, float]] = ()):
        convex, concave = [], []  # (shape, base height, top height) and (footprint, height)
        for fp, h in buildings:
            if not fp.interiors and fp.area >= CONVEX_AREA_RATIO * fp.convex_hull.area:
                convex.append((fp, 0.0, h))
            else:
                concave.append((fp, h))
        convex += [(Point(x, y).buffer(TREE_CROWN_RADIUS_M, quad_segs=3), TREE_CANOPY_BASE_M, TREE_HEIGHT_M)
                   for x, y in trees]

        # Convex shapes: all vertices in one array, with the index of the shape each belongs to.
        verts, owner = [], []
        for i, (shape, _, _) in enumerate(convex):
            c = np.asarray(shape.exterior.coords)[:-1]
            verts.append(c)
            owner.append(np.full(len(c), i))
        self._cvx_xy = np.concatenate(verts) if verts else np.empty((0, 2))
        self._cvx_owner = np.concatenate(owner) if owner else np.empty(0, dtype=int)
        self._cvx_base = np.array([b for _, b, _ in convex])
        self._cvx_h = np.array([h for _, _, h in convex])

        # Concave footprints: their wall segments (p1 -> p2) and heights.
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

    def pieces(self, sun: SunPosition) -> np.ndarray:
        """Overlapping polygons whose union is the shadow (none when the sun is below 3 degrees)."""
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
            pieces.append(sweeps[shapely.area(sweeps) > 0])  # walls parallel to the sun sweep no area

        return np.concatenate(pieces)
