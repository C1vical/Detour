import random
from datetime import datetime
from zoneinfo import ZoneInfo

import geopandas as gpd
import networkx as nx
import pytest
from shapely.geometry import box

from backend.data import CACHE_DIR, CAMPUS_CENTER, METRIC_CRS, CampusData, load_campus
from backend.exposure import ExposureModel, SunSchedule
from backend.router import NoRouteError, route
from backend.walking import travel_time_seconds

TZ = ZoneInfo("America/Toronto")
# Near solar noon at York on 21 June (sun in the south, ~66 deg elevation).
NOON = datetime(2026, 6, 21, 13, 15, tzinfo=TZ)
DAY = datetime(2026, 6, 21, tzinfo=TZ)


def _toy_campus() -> CampusData:
    """Direct open path A-B (100 m) vs detour A-C1-C2-B (120 m) passing under a tall building's shadow.

    Sun is due south, so a 40 m building at y in [-30,-20] shades y in about [-20,-2],
    which covers the middle 60 m of the detour (y = -10) but not the direct path (y = 0).
    """
    g = nx.MultiDiGraph()
    pts = {"A": (0, 0), "B": (100, 0), "C1": (0, -10), "C2": (100, -10), "D": (300, 300)}  # D is unreachable
    ids = {n: i for i, n in enumerate(pts)}
    for n, (x, y) in pts.items():
        g.add_node(ids[n], x=float(x), y=float(y))

    def link(a, b):
        (x1, y1), (x2, y2) = pts[a], pts[b]
        length = ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5
        g.add_edge(ids[a], ids[b], length=length)
        g.add_edge(ids[b], ids[a], length=length)

    link("A", "B"); link("A", "C1"); link("C1", "C2"); link("C2", "B")
    buildings = gpd.GeoDataFrame({"height_m": [40.0]},
                                 geometry=[box(20, -30, 80, -20)], crs=METRIC_CRS)
    trees = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs=METRIC_CRS)
    return CampusData(g, buildings, trees, box(-50, -50, 150, 50)), ids


@pytest.fixture(scope="module")
def toy():
    data, ids = _toy_campus()
    model = ExposureModel(data, SunSchedule(*CAMPUS_CENTER, DAY))
    return model, ids


def test_fastest_route_goes_direct(toy):
    model, ids = toy
    r = route(model, ids["A"], ids["B"], NOON, w_sun=0.0)
    assert r.nodes == [ids["A"], ids["B"]]
    assert r.seconds == pytest.approx(travel_time_seconds(100.0, 0.0))


def test_sun_weight_prefers_shaded_detour(toy):
    model, ids = toy
    fast = route(model, ids["A"], ids["B"], NOON, w_sun=0.0)
    shady = route(model, ids["A"], ids["B"], NOON, w_sun=5.0)
    assert shady.nodes == [ids["A"], ids["C1"], ids["C2"], ids["B"]]
    assert shady.seconds > fast.seconds
    assert shady.sun_seconds < fast.sun_seconds
    assert shady.sun_percent < fast.sun_percent


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


@pytest.mark.skipif(not (CACHE_DIR / "walk.graphml").exists(), reason="campus cache not downloaded")
def test_astar_matches_dijkstra_on_campus():
    data = load_campus()
    model = ExposureModel(data, SunSchedule(*CAMPUS_CENTER, DAY))
    nodes = list(data.graph.nodes)
    rng = random.Random(0)
    start = datetime(2026, 6, 21, 15, 0, tzinfo=TZ)
    tested = 0
    while tested < 5:
        a, b = rng.sample(nodes, 2)
        try:
            d = route(model, a, b, start, w_sun=2.0, use_astar=False)
        except NoRouteError:
            continue
        s = route(model, a, b, start, w_sun=2.0, use_astar=True)
        assert s.cost == pytest.approx(d.cost, rel=1e-9)
        assert s.expanded <= d.expanded
        tested += 1
