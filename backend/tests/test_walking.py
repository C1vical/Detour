import networkx as nx
import pytest
from shapely.geometry import box
import geopandas as gpd

from backend.data import METRIC_CRS
from backend.walking import (
    assign_node_elevations,
    edge_grade,
    grade_angle_degrees,
    travel_time_seconds,
    tobler_speed_kmh,
    walking_speed_mps,
)


def test_grade_and_angle_use_signed_elevation_change():
    assert edge_grade(100.0, 110.0, 100.0) == pytest.approx(0.1)
    assert grade_angle_degrees(0.1) == pytest.approx(5.7106, rel=1e-4)


def test_tobler_speed_matches_formula():
    assert tobler_speed_kmh(0.0) == pytest.approx(6 * (2.718281828 ** (-3.5 * 0.05)))
    assert walking_speed_mps(-0.05) > walking_speed_mps(0.2)


def test_travel_time_is_distance_over_grade_adjusted_speed():
    assert travel_time_seconds(100.0, 0.1) == pytest.approx(100.0 / walking_speed_mps(0.1))


def test_assign_node_elevations_uses_nearest_mass_surface():
    graph = nx.MultiDiGraph()
    graph.add_node("a", x=0.0, y=0.0)
    graph.add_node("b", x=100.0, y=0.0)
    buildings = gpd.GeoDataFrame(
        {"SURF_ELEV": [150.0, 210.0]},
        geometry=[box(-10, -10, 10, 10), box(90, -10, 110, 10)],
        crs=METRIC_CRS,
    )

    assign_node_elevations(graph, buildings)

    assert graph.nodes["a"]["elevation_m"] == 150.0
    assert graph.nodes["b"]["elevation_m"] == 210.0
