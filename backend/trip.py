"""The fixed demo trip (south-west of Keele campus to the north-east) and node lookup."""
import geopandas as gpd
import networkx as nx
import osmnx as ox

from .data import METRIC_CRS

ORIGIN = (43.7715, -79.5100)  # (lat, lon)
DEST = (43.7790, -79.4960)


def nearest_node(graph: nx.MultiDiGraph, latlon: tuple[float, float]) -> int:
    """Graph node closest to a (lat, lon) point."""
    pt = gpd.GeoSeries.from_xy([latlon[1]], [latlon[0]], crs="EPSG:4326").to_crs(METRIC_CRS).iloc[0]
    return ox.distance.nearest_nodes(graph, pt.x, pt.y)
