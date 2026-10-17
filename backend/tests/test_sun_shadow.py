from datetime import datetime, timezone

import pytest
from shapely.geometry import box

from backend.shadow import building_shadow, shadow_length, shadow_offset, shadow_union
from backend.sun import SunPosition, sun_position, sun_position_simple

UTC = timezone.utc


def test_overhead_sun_at_equinox_equator():
    sp = sun_position(0.0, 0.0, datetime(2026, 3, 20, 12, 0, tzinfo=UTC))
    assert sp.elevation > 85


@pytest.mark.parametrize("hour", [9, 12, 15, 18])
def test_simple_matches_pvlib(hour):
    when = datetime(2026, 6, 21, hour, 0, tzinfo=UTC)
    a = sun_position(40.0, 0.0, when)
    b = sun_position_simple(40.0, 0.0, when)
    assert abs(a.elevation - b.elevation) < 2.0
    assert abs(a.azimuth - b.azimuth) < 4.0


def test_shadow_length_45_degrees():
    assert shadow_length(10.0, 45.0) == pytest.approx(10.0)


def test_shadow_length_30_degrees():
    assert shadow_length(10.0, 30.0) == pytest.approx(10.0 * 3 ** 0.5)


def test_shadow_length_is_capped():
    assert shadow_length(100.0, 0.1) == 300.0


def test_shadow_direction_sun_in_south_casts_north():
    dx, dy = shadow_offset(10.0, SunPosition(45.0, 180.0))
    assert dx == pytest.approx(0.0, abs=1e-9)
    assert dy == pytest.approx(10.0)


def test_shadow_direction_sun_in_east_casts_west():
    dx, dy = shadow_offset(10.0, SunPosition(45.0, 90.0))
    assert dx == pytest.approx(-10.0)
    assert dy == pytest.approx(0.0, abs=1e-9)


def test_single_building_shadow_area():
    # 10x10 footprint, 10 m tall, sun due south at 45 deg:
    # shadow = footprint + 10x10 strip to the north -> 200 m^2.
    sh = building_shadow(box(0, 0, 10, 10), 10.0, SunPosition(45.0, 180.0))
    assert sh.area == pytest.approx(200.0)
    assert sh.bounds == pytest.approx((0, 0, 10, 20))


def test_diagonal_shadow_area():
    # Sun in the SW (az 225) at 45 deg, 10 m tall: offset is (+7.07, +7.07).
    # Swept area of a square s x s along (dx, dy): s^2 + s*|dx| + s*|dy|.
    sh = building_shadow(box(0, 0, 10, 10), 10.0, SunPosition(45.0, 225.0))
    assert sh.area == pytest.approx(100 + 10 * 7.0711 * 2, rel=1e-3)


def test_no_shadow_when_sun_low():
    assert shadow_union([(box(0, 0, 10, 10), 10.0)], SunPosition(1.0, 180.0)).is_empty


# --- trees ---------------------------------------------------------------

from backend.shadow import (  # noqa: E402
    TREE_CANOPY_BASE_M,
    TREE_CROWN_RADIUS_M,
    TREE_HEIGHT_M,
    ShadowCaster,
    tree_crown,
)
from shapely.geometry import Point  # noqa: E402


def test_tree_shadow_falls_away_from_the_sun():
    # sun due south at 45 degrees: shadows point north
    tree_shadow = ShadowCaster([], [(0.0, 0.0)]).shadow(SunPosition(45.0, 180.0))
    minx, miny, maxx, maxy = tree_shadow.bounds
    assert maxy == pytest.approx(TREE_CROWN_RADIUS_M + TREE_HEIGHT_M, abs=0.1)
    assert miny == pytest.approx(-TREE_CROWN_RADIUS_M + TREE_CANOPY_BASE_M, abs=0.1)
    assert maxx - minx == pytest.approx(2 * TREE_CROWN_RADIUS_M, abs=0.2)


def test_high_sun_shades_the_ground_under_the_crown():
    shadow = ShadowCaster([], [(0.0, 0.0)]).shadow(SunPosition(89.0, 180.0))
    assert shadow.contains(Point(0.0, 0.0))


def test_low_sun_leaves_the_ground_under_the_crown_lit():
    # at 20 degrees the crown base (2 m up) is ~5.5 m away, past the 3 m crown radius
    shadow = ShadowCaster([], [(0.0, 0.0)]).shadow(SunPosition(20.0, 180.0))
    assert not shadow.contains(Point(0.0, 0.0))
    assert shadow.contains(Point(0.0, 8.0))


def test_trees_add_to_building_shadows_without_changing_them():
    sun = SunPosition(45.0, 180.0)
    building = [(box(0, 0, 10, 10), 10.0)]
    with_trees = ShadowCaster(building, [(50.0, 50.0)]).shadow(sun)
    without = ShadowCaster(building).shadow(sun)
    assert with_trees.area == pytest.approx(without.area + ShadowCaster([], [(50.0, 50.0)]).shadow(sun).area)
    assert with_trees.contains(Point(5, 15))


def test_no_tree_shadow_at_night():
    assert ShadowCaster([], [(0.0, 0.0)]).shadow(SunPosition(-10.0, 180.0)).is_empty


def test_tree_crown_is_a_disk_of_the_crown_radius():
    crown = tree_crown(5.0, 5.0)
    assert crown.centroid.x == pytest.approx(5.0)
    assert crown.area == pytest.approx(3.14159 * TREE_CROWN_RADIUS_M**2, rel=0.1)
