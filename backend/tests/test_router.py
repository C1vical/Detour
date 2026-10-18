import random
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import geopandas as gpd
import networkx as nx
import numpy as np
import pandas as pd
import pytest
import shapely
from shapely.geometry import box

from backend.data import CACHE_DIR, CAMPUS_CENTER, METRIC_CRS, CampusData, load_campus
from backend.exposure import MAX_CACHED_SLICES, ExposureModel, SunSchedule
from backend.sun import sun_positions
from backend.router import MAX_DETOUR, SUN_STEP, NoRouteError, RouteResult, pick, route, shade_options
from backend.weather import DayWeather

TZ = ZoneInfo("America/Toronto")
# Near solar noon at York on 21 June (sun in the south, ~66 deg elevation).
NOON = datetime(2026, 6, 21, 13, 15, tzinfo=TZ)
DAY = datetime(2026, 6, 21, tzinfo=TZ)


def _toy_campus(footprint=box(20, -30, 80, -20), height=40.0, detour_tags=None) -> CampusData:
    """Direct open path A-B (100 m) vs detour A-C1-C2-B (120 m) passing under a tall building's shadow.

    Sun is due south, so a 40 m building at y in [-30,-20] shades y in about [-20,-2],
    which covers the middle 60 m of the detour (y = -10) but not the direct path (y = 0).
    `detour_tags` are OSM tags put on the middle detour edge C1-C2.
    """
    g = nx.MultiDiGraph()
    pts = {"A": (0, 0), "B": (100, 0), "C1": (0, -10), "C2": (100, -10), "D": (300, 300)}  # D is unreachable
    ids = {n: i for i, n in enumerate(pts)}
    for n, (x, y) in pts.items():
        g.add_node(ids[n], x=float(x), y=float(y))

    def link(a, b, **tags):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        length = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
        g.add_edge(ids[a], ids[b], length=length, **tags)
        g.add_edge(ids[b], ids[a], length=length, **tags)

    link("A", "B"); link("A", "C1"); link("C1", "C2", **(detour_tags or {})); link("C2", "B")
    buildings = gpd.GeoDataFrame({"height_m": [height]}, geometry=[footprint], crs=METRIC_CRS)
    trees = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs=METRIC_CRS)
    return CampusData(g, buildings, trees, box(-50, -50, 150, 50)), ids


@pytest.fixture(scope="module")
def toy():
    data, ids = _toy_campus()
    model = ExposureModel(data, SunSchedule(*CAMPUS_CENTER, DAY))
    return model, ids


@pytest.mark.parametrize("day", [datetime(2026, 11, 1, tzinfo=TZ),   # DST ends at 02:00
                                 datetime(2026, 3, 8, tzinfo=TZ),    # DST starts at 02:00
                                 DAY])
def test_schedule_matches_pvlib_on_dst_change_days(day):
    noon = day.replace(hour=12)
    pos = SunSchedule(*CAMPUS_CENTER, day).position(noon)
    truth = sun_positions(*CAMPUS_CENTER, pd.DatetimeIndex([noon])).iloc[0]
    assert pos.elevation == pytest.approx(truth["elevation"], abs=0.05)
    assert pos.azimuth == pytest.approx(truth["azimuth"], abs=0.2)


def test_fastest_route_goes_direct(toy):
    model, ids = toy
    r = route(model, ids["A"], ids["B"], NOON, w_sun=0.0)
    assert r.nodes == [ids["A"], ids["B"]]
    assert r.seconds == pytest.approx(100 / 1.4)


def test_sun_weight_prefers_shaded_detour(toy):
    model, ids = toy
    fast = route(model, ids["A"], ids["B"], NOON, w_sun=0.0)
    shady = route(model, ids["A"], ids["B"], NOON, w_sun=5.0)
    assert shady.nodes == [ids["A"], ids["C1"], ids["C2"], ids["B"]]
    assert shady.seconds > fast.seconds
    assert shady.sun_seconds < fast.sun_seconds
    assert shady.sun_percent < fast.sun_percent


def test_shade_options_are_the_direct_path_and_the_shaded_detour(toy):
    model, ids = toy
    options = shade_options(model, ids["A"], ids["B"], NOON)
    assert [o.nodes for o in options] == [[ids["A"], ids["B"]], [ids["A"], ids["C1"], ids["C2"], ids["B"]]]
    assert options[0].seconds == pytest.approx(100 / 1.4)
    assert pick(options, 0.0) is options[0] and pick(options, 1.0) is options[1]


def test_pick_takes_the_quickest_option_that_avoids_enough_sun():
    def opt(seconds, sun):
        return RouteResult([], [], seconds, 0.0, sun, 100.0, 0.0, 0.0, cost=seconds)
    options = [opt(600, 100), opt(620, 70), opt(650, 40), opt(700, 0)]  # 100 sun-seconds avoidable
    assert [pick(options, a).seconds for a in (0.0, 0.2, 0.3, 0.5, 0.6, 0.61, 1.0)] == \
        [600, 620, 620, 650, 650, 700, 700]


def test_no_route_to_an_unconnected_node(toy):
    model, ids = toy
    with pytest.raises(NoRouteError):
        route(model, ids["A"], ids["D"], NOON)


def test_night_has_no_sun_exposure(toy):
    model, ids = toy
    night = datetime(2026, 6, 21, 2, 0, tzinfo=TZ)
    r = route(model, ids["A"], ids["B"], night, w_sun=5.0)
    assert r.sun_seconds == 0.0
    assert r.nodes == [ids["A"], ids["B"]]  # nothing to avoid, so shortest wins


def test_shade_fraction_of_detour_middle(toy):
    model, ids = toy
    f = model.shade_fractions(NOON)
    mid = model.edge_index[(ids["C1"], ids["C2"], 0)]
    direct = model.edge_index[(ids["A"], ids["B"], 0)]
    assert f[mid] == pytest.approx(0.6, abs=0.03)
    assert f[direct] == pytest.approx(0.0, abs=1e-6)


def test_shade_cache_is_bounded(toy):
    model, _ = toy
    for i in range(MAX_CACHED_SLICES + 5):
        model.shade_fractions(DAY + timedelta(seconds=i * model.slice_seconds))
    assert len(model._shade_cache) <= MAX_CACHED_SLICES


# --- the real campus ----------------------------------------------------------

@pytest.fixture(scope="module")
def campus():
    if not (CACHE_DIR / "walk.graphml").exists():
        pytest.skip("campus cache not downloaded")
    data = load_campus()
    return data, ExposureModel(data, SunSchedule(*CAMPUS_CENTER, DAY))


def _connected_pairs(graph, n, seed=0):
    nodes, rng, pairs = list(graph.nodes), random.Random(seed), []
    while len(pairs) < n:
        a, b = rng.sample(nodes, 2)
        if nx.has_path(graph, a, b):
            pairs.append((a, b))
    return pairs


def test_fastest_route_matches_networkx_shortest_path(campus):
    data, model = campus
    for a, b in _connected_pairs(data.graph, 10):
        r = route(model, a, b, NOON)
        assert r.seconds == pytest.approx(nx.shortest_path_length(data.graph, a, b, weight="length") / 1.4)


def test_astar_matches_dijkstra_on_campus(campus):
    # The heuristic stays consistent when sun and rain are weighted, so A* finds the same routes.
    data, model = campus
    rainy = model.with_sun(SunSchedule(*CAMPUS_CENTER, DAY, _weather(direct=700.0, rain=3.0)))
    start = datetime(2026, 6, 21, 15, 0, tzinfo=TZ)
    astar_expanded = dijkstra_expanded = 0
    for a, b in _connected_pairs(data.graph, 5):
        for m, w_sun, w_rain in [(model, 0.0, 0.0), (model, 2.0, 0.0), (rainy, 5.0, 10.0)]:
            d = route(m, a, b, start, w_sun=w_sun, w_rain=w_rain, use_astar=False)
            s = route(m, a, b, start, w_sun=w_sun, w_rain=w_rain, use_astar=True)
            assert s.cost == pytest.approx(d.cost, rel=1e-9)
            astar_expanded += s.expanded
            dijkstra_expanded += d.expanded
    assert astar_expanded < dijkstra_expanded


def test_shade_options_form_a_trade_off_that_covers_every_weighted_route(campus):
    # Options get strictly slower and shadier, stay within the detour cap, and every route a
    # weighted sum time + w * sun would choose is one of them (or within SUN_STEP of one).
    data, model = campus
    start = datetime(2026, 6, 21, 14, 0, tzinfo=TZ)
    for a, b in _connected_pairs(data.graph, 4, seed=1):
        options = shade_options(model, a, b, start)
        fastest = route(model, a, b, start)
        assert options[0].seconds == pytest.approx(fastest.seconds)
        for prev, nxt in zip(options, options[1:]):
            assert nxt.cost >= prev.cost and nxt.sun_seconds < prev.sun_seconds
        assert options[-1].cost <= fastest.cost * (1 + MAX_DETOUR) + 1e-6
        step = max(1.0, SUN_STEP * fastest.sun_seconds)
        for w in (0.1, 0.5, 2.0, 10.0):
            r = route(model, a, b, start, w_sun=w)
            if r.seconds <= fastest.seconds * (1 + MAX_DETOUR):
                assert any(o.seconds <= r.seconds + 1e-6 and o.sun_seconds <= r.sun_seconds + step
                           for o in options)


def test_sampled_shade_matches_exact_geometry_on_campus(campus):
    # Length-weighted over the campus, the 1.5 m sample points match exact line/shadow overlap.
    _, model = campus
    for hour in (9, 13, 17):
        when = datetime(2026, 6, 21, hour, 0, tzinfo=TZ)
        parts = shapely.get_parts(model.shadow_at(when))  # disjoint, so overlap lengths add up
        li, pi = shapely.STRtree(parts).query(model._lines, predicate="intersects")
        overlap = shapely.length(shapely.intersection(model._lines[li], parts[pi]))
        exact = np.bincount(li, overlap, minlength=len(model.edges)) / model._geom_len
        sampled = model.shade_fractions(when)
        weights = model._geom_len / model._geom_len.sum()
        assert (sampled * weights).sum() == pytest.approx((exact * weights).sum(), abs=0.005)


# --- rain and shelter ---------------------------------------------------------

def _weather(direct=0.0, cloud=100.0, rain=0.0) -> DayWeather:
    return DayWeather.from_hourly({"direct_radiation": [direct] * 24, "cloud_cover": [cloud] * 24,
                                   "precipitation": [rain] * 24})


def _rainy_toy(rain_mm_h=4.0, **kw):
    """Toy campus where a low building roofs the middle 60 m of the detour's C1-C2 edge."""
    data, ids = _toy_campus(**kw)
    return ExposureModel(data, SunSchedule(*CAMPUS_CENTER, DAY, _weather(rain=rain_mm_h))), ids


def _edge(model, ids, a, b):
    return model.edge_index[(ids[a], ids[b], 0)]


def test_shelter_fraction_counts_the_edge_inside_a_building():
    model, ids = _rainy_toy(footprint=box(20, -15, 80, -5), height=3.0)
    assert model.shelter[_edge(model, ids, "C1", "C2")] == pytest.approx(0.6, abs=0.03)
    assert model.shelter[_edge(model, ids, "A", "B")] == 0.0


def test_roofed_osm_tags_count_as_fully_sheltered():
    model, ids = _rainy_toy(detour_tags={"tunnel": "building_passage"})
    assert model.shelter[_edge(model, ids, "C1", "C2")] == 1.0
    model, ids = _rainy_toy(detour_tags={"covered": "['no', 'yes']"})  # merged edge, GraphML list
    assert model.shelter[_edge(model, ids, "C1", "C2")] == 1.0


def test_rain_weight_prefers_sheltered_detour_while_raining():
    model, ids = _rainy_toy(footprint=box(20, -15, 80, -5), height=3.0)
    fast = route(model, ids["A"], ids["B"], NOON)
    ctx = pick(shade_options(model, ids["A"], ids["B"], NOON, w_rain=5.0), 0.0)
    assert fast.nodes == [ids["A"], ids["B"]]
    assert ctx.nodes == [ids["A"], ids["C1"], ids["C2"], ids["B"]]
    assert ctx.rain_percent < fast.rain_percent == pytest.approx(100.0)


def test_rain_weight_does_nothing_when_dry():
    model, ids = _rainy_toy(rain_mm_h=0.0, footprint=box(20, -15, 80, -5), height=3.0)
    r = route(model, ids["A"], ids["B"], NOON, w_rain=5.0)
    assert r.nodes == [ids["A"], ids["B"]]
    assert r.rain_seconds == 0.0 and r.rain_percent == 0.0


def test_live_direct_radiation_drives_sun_exposure():
    # Overcast (no direct beam) means nothing to avoid, so the sun weight keeps the direct path.
    data, ids = _toy_campus()
    overcast = ExposureModel(data, SunSchedule(*CAMPUS_CENTER, DAY, _weather(direct=0.0)))
    r = route(overcast, ids["A"], ids["B"], NOON, w_sun=5.0)
    assert r.sun_seconds == 0.0 and r.nodes == [ids["A"], ids["B"]]
    sunny = SunSchedule(*CAMPUS_CENTER, DAY, _weather(direct=800.0))
    assert sunny.intensity(NOON) == pytest.approx(0.8)


def test_shadow_pieces_are_counter_clockwise_and_cover_the_shadow(campus):
    # /shadows draws these with the nonzero fill rule, which needs consistent winding.
    _, model = campus
    when = datetime(2026, 6, 21, 16, 0, tzinfo=TZ)
    pieces = model.shadow_pieces_at(when)
    assert all(shapely.is_ccw(p.exterior) for p in pieces)
    assert all(not shapely.is_ccw(hole) for p in pieces for hole in p.interiors)
    exact = model.shadow_at(when)
    assert shapely.union_all(pieces).symmetric_difference(exact).area < 1e-6 * exact.area


def test_intensity_interpolates_between_minutes_like_numpy():
    sun = SunSchedule(*CAMPUS_CENTER, DAY, _weather(direct=500.0))
    rng = random.Random(0)
    for _ in range(50):
        when = DAY + timedelta(seconds=rng.uniform(-600, 25 * 3600))  # including outside the day
        minutes = (when - DAY).total_seconds() / 60
        expected = np.interp(minutes, np.arange(len(sun._intensity)), sun._intensity)
        assert sun.intensity(when) == pytest.approx(expected)
