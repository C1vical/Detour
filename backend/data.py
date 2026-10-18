"""Campus data in a metric CRS (UTM 17N: x = east, y = north, metres): the OSM walk graph, boundary
and trees, plus City of Toronto 3D Massing buildings. Loaded from backend/cache/, downloaded if missing."""
from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

import geopandas as gpd
import networkx as nx
import osmnx as ox
import shapely
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

from .shadow import MAX_SHADOW_LENGTH_M

# Keep the tags that mark a walkway as roofed (see SHELTER_TAGS in exposure.py).
ox.settings.useful_tags_way = sorted(set(ox.settings.useful_tags_way) | {"covered", "indoor", "tunnel"})

CAMPUS_CENTER = (43.7735, -79.5019)  # (lat, lon), about Vari Hall; used for the sun and the weather
CAMPUS_OSM_WAY = 15396822            # "York University, Keele Campus"
METRIC_CRS = "EPSG:32617"
GRAPH_BUFFER_M = 100.0   # the walk network extends this far past the campus boundary

CACHE_DIR = Path(__file__).parent / "cache"
MASSING_FILE = Path(__file__).parent / "data" / "york_building_heights.geojson"
MASSING_YEAR = 2025
# Public Overpass mirrors, tried in turn (the main one is often at capacity).
OVERPASS_URLS = [
    "https://overpass-api.de/api",
    "https://overpass.private.coffee/api",
    "https://overpass.kumi.systems/api",
]


@dataclass
class CampusData:
    graph: nx.MultiDiGraph          # walk network, node x/y in metres
    buildings: gpd.GeoDataFrame     # geometry (Polygon), height_m
    trees: gpd.GeoDataFrame         # points (OSM natural=tree)
    campus: BaseGeometry            # campus boundary polygon


def load_campus() -> CampusData:
    """The campus walk graph, buildings, trees and boundary, from the cache or downloaded once."""
    CACHE_DIR.mkdir(exist_ok=True)
    graph_f, bld_f, tree_f, poly_f = (
        CACHE_DIR / n for n in ("walk.graphml", "toronto_buildings.gpkg", "trees.gpkg", "campus.gpkg")
    )
    if all(f.exists() for f in (graph_f, bld_f, tree_f, poly_f)):
        buildings = gpd.read_file(bld_f)
        buildings.geometry = shapely.force_2d(buildings.geometry.array)
        return CampusData(ox.load_graphml(graph_f), buildings, gpd.read_file(tree_f),
                          gpd.read_file(poly_f).geometry.iloc[0])

    campus = ox.geocode_to_gdf([f"W{CAMPUS_OSM_WAY}"], by_osmid=True).to_crs(METRIC_CRS).geometry.iloc[0]
    to_wgs84 = lambda geom: gpd.GeoSeries([geom], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]  # noqa: E731
    graph = _with_retries(lambda: ox.graph_from_polygon(
        to_wgs84(campus.buffer(GRAPH_BUFFER_M)), network_type="walk", truncate_by_edge=True
    ))
    graph = ox.project_graph(graph, to_crs=METRIC_CRS)
    buildings = _load_massing_buildings()
    try:  # trees within shadow reach of the campus
        raw = _with_retries(lambda: ox.features_from_polygon(
            to_wgs84(campus.buffer(MAX_SHADOW_LENGTH_M)), tags={"natural": "tree"}))
        trees = raw[raw.geometry.type == "Point"].to_crs(METRIC_CRS)[["geometry"]].reset_index(drop=True)
    except Exception:  # osmnx raises if nothing matches (or every mirror failed)
        trees = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs=METRIC_CRS)

    ox.save_graphml(graph, graph_f)
    buildings.to_file(bld_f, driver="GPKG")
    trees.to_file(tree_f, driver="GPKG")
    gpd.GeoDataFrame({"geometry": [campus]}, crs=METRIC_CRS).to_file(poly_f, driver="GPKG")
    return CampusData(graph, buildings, trees, campus)


def _load_massing_buildings() -> gpd.GeoDataFrame:
    """Packaged Toronto 3D Massing footprints, using MAX_HEIGHT as the building height."""
    raw = gpd.read_file(MASSING_FILE)
    buildings = raw[raw.geometry.type.isin(["Polygon", "MultiPolygon"])].copy().explode(index_parts=False)
    buildings.geometry = shapely.force_2d(buildings.geometry.array)
    buildings["height_m"] = buildings["MAX_HEIGHT"].astype(float)
    buildings["height_source"] = f"toronto_3d_massing_{MASSING_YEAR}"
    buildings["height_data_source"] = buildings["HEIGHT_SRC"].fillna("unknown")
    return buildings[["geometry", "height_m", "height_source", "height_data_source"]].to_crs(METRIC_CRS)


def _with_retries(fn, attempts: int = 6):
    """Run an OSMnx download, rotating Overpass mirrors with growing waits."""
    delay = 5.0
    for i in range(attempts):
        ox.settings.overpass_url = OVERPASS_URLS[i % len(OVERPASS_URLS)]
        try:
            return fn()
        except Exception as exc:  # network error, overload or rate limit
            if i == attempts - 1:
                raise
            print(f"Overpass attempt {i + 1} failed ({type(exc).__name__}); retrying in {delay:.0f}s")
            time.sleep(delay)
            delay *= 1.5


def building_list(data: CampusData) -> list[tuple[Polygon, float]]:
    """(footprint, height_m) pairs for ShadowCaster."""
    return list(zip(data.buildings.geometry, data.buildings.height_m))


def tree_list(data: CampusData) -> list[tuple[float, float]]:
    """(x, y) tree centres for ShadowCaster."""
    return [(p.x, p.y) for p in data.trees.geometry]
