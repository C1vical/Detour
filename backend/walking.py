"""Grade-aware walking speeds and travel times."""
from __future__ import annotations

import math

import geopandas as gpd
import networkx as nx
import numpy as np
import shapely
from shapely.geometry import Point

TOBLER_BASE_SPEED_KMH = 6.0
TOBLER_GRADE_FACTOR = 3.5
TOBLER_PREFERRED_GRADE = -0.05
KMH_TO_MPS = 1000.0 / 3600.0


def tobler_speed_kmh(grade: float) -> float:
    """Return Tobler's hiking speed for a signed grade ratio."""
    return TOBLER_BASE_SPEED_KMH * math.exp(
        -TOBLER_GRADE_FACTOR * abs(grade + TOBLER_PREFERRED_GRADE)
    )


def walking_speed_mps(grade: float) -> float:
    return tobler_speed_kmh(grade) * KMH_TO_MPS


MAX_TOBLER_SPEED_MPS = walking_speed_mps(TOBLER_PREFERRED_GRADE)


def edge_grade(elevation_u: float, elevation_v: float, distance_m: float) -> float:
    """Return signed grade for a directed edge from u to v."""
    if distance_m <= 0:
        return 0.0
    return (elevation_v - elevation_u) / distance_m


def grade_angle_degrees(grade: float) -> float:
    return math.degrees(math.atan(grade))


def travel_time_seconds(distance_m: float, grade: float) -> float:
    if distance_m <= 0:
        return 0.0
    return distance_m / walking_speed_mps(grade)


def annotate_graph_edges(graph: nx.MultiDiGraph) -> nx.MultiDiGraph:
    """Add grade, angle, Tobler speed, and travel time to every directed edge."""
    for u, v, _, attrs in graph.edges(keys=True, data=True):
        elevation_u = float(graph.nodes[u].get("elevation_m", 0.0))
        elevation_v = float(graph.nodes[v].get("elevation_m", 0.0))
        distance_m = float(attrs.get("length", 0.0))
        grade = edge_grade(elevation_u, elevation_v, distance_m)
        attrs["elevation_gain_m"] = elevation_v - elevation_u
        attrs["grade"] = grade
        attrs["grade_angle_deg"] = grade_angle_degrees(grade)
        attrs["speed_mps"] = walking_speed_mps(grade)
        attrs["travel_time_s"] = travel_time_seconds(distance_m, grade)
    return graph


def assign_node_elevations(
    graph: nx.MultiDiGraph,
    buildings: gpd.GeoDataFrame,
) -> nx.MultiDiGraph:
    """Assign each walk node the nearest Toronto massing surface elevation.

    The Toronto field is reported per building footprint, so this uses the
    nearest footprint as a proxy for the ground elevation at open walk nodes.
    """
    if "SURF_ELEV" not in buildings:
        raise ValueError("Toronto massing data must contain SURF_ELEV.")
    if buildings.empty:
        raise ValueError("Cannot assign elevations from an empty massing dataset.")

    geometries = buildings.geometry.array
    tree = shapely.STRtree(geometries)
    nodes = list(graph.nodes)
    points = [Point(float(graph.nodes[node]["x"]), float(graph.nodes[node]["y"])) for node in nodes]
    nearest_indices = np.asarray(tree.nearest(points), dtype=int)
    elevations = buildings.iloc[nearest_indices]["SURF_ELEV"].astype(float).to_numpy()

    for node, elevation in zip(nodes, elevations):
        graph.nodes[node]["elevation_m"] = float(elevation)
    return graph
