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

from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from .sun import SunPosition

# Below this elevation the shadow is so long the model stops being meaningful.
MIN_ELEVATION_DEG = 3.0
# Shadow length cap in metres (tan(theta) -> 0 makes L -> infinity).
MAX_SHADOW_LENGTH_M = 300.0

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


def building_shadow(footprint: Polygon, height: float, sun: SunPosition) -> BaseGeometry:
    """Ground shadow of one extruded building (includes the footprint itself)."""
    dx, dy = shadow_offset(height, sun)
    parts: list[BaseGeometry] = [footprint]
    for ring in [footprint.exterior, *footprint.interiors]:
        coords = list(ring.coords)
        for (x1, y1), (x2, y2) in zip(coords[:-1], coords[1:]):
            parts.append(Polygon([(x1, y1), (x2, y2), (x2 + dx, y2 + dy), (x1 + dx, y1 + dy)]))
    return unary_union(parts)


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


def shadow_union(buildings: Iterable[tuple[Polygon, float]], sun: SunPosition) -> BaseGeometry:
    """Union of all building shadows for one sun position.

    `buildings` is an iterable of (footprint, height_m). Returns an empty
    polygon when the sun is below MIN_ELEVATION_DEG (the caller handles night
    separately: with no sun there is no sun exposure to accumulate).
    """
    if sun.elevation < MIN_ELEVATION_DEG:
        return Polygon()
    return unary_union([building_shadow(fp, h, sun) for fp, h in buildings])
