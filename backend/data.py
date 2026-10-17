"""Load York University (Keele campus) map data and Toronto 3D Massing heights.

The campus extent and pedestrian network come from OpenStreetMap via OSMnx.
Building footprints and heights come from the City of Toronto's 2025 3D
Massing WGS84 snapshot packaged under backend/data/.

Everything is projected to a local metric CRS (UTM zone 17N, EPSG:32617) so
x = east (m), y = north (m), matching the conventions in shadow.py.
Results are cached under backend/cache/ so the Overpass API is only hit once.
"""
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
from .walking import annotate_graph_edges, assign_node_elevations

CAMPUS_CENTER = (43.7735, -79.5019)  # (lat, lon) approx. Vari Hall; used for sun position
CAMPUS_OSM_WAY = 15396822            # "York University, Keele Campus"
METRIC_CRS = "EPSG:32617"
GRAPH_BUFFER_M = 100.0   # walk network extends this far past the campus boundary
SHADOW_BUFFER_M = 300.0  # buildings this far out can shade campus (= MAX_SHADOW_LENGTH_M)

CACHE_DIR = Path(__file__).parent / "cache"
MASSING_FILE = Path(__file__).parent / "data" / "york_building_heights.geojson"
MASSING_YEAR = 2025

# Public Overpass mirrors, tried in order (the main one is often at capacity).
OVERPASS_URLS = [
    "https://overpass-api.de/api",
    "https://overpass.private.coffee/api",
    "https://overpass.kumi.systems/api",
]


def _with_retries(fn, attempts: int = 6):
    """Run an OSMnx download, rotating Overpass mirrors with exponential backoff."""
    delay = 5.0
    for i in range(attempts):
        ox.settings.overpass_url = OVERPASS_URLS[i % len(OVERPASS_URLS)]
        try:
            return fn()
        except Exception as exc:  # network / overload / rate limit
            if i == attempts - 1:
                raise
            print(f"Overpass attempt {i + 1} failed ({type(exc).__name__}); retrying in {delay:.0f}s")
            time.sleep(delay)
            delay *= 1.5


@dataclass
class CampusData:
    graph: nx.MultiDiGraph          # walk network, projected (node x/y in metres)
    buildings: gpd.GeoDataFrame     # columns: geometry (Polygon), height_m, height_source
    trees: gpd.GeoDataFrame         # point geometries (natural=tree)
    campus: BaseGeometry            # campus boundary polygon, metric CRS


def _load_massing_buildings() -> gpd.GeoDataFrame:
    """Load packaged Toronto footprints and use MAX_HEIGHT for shadow envelopes."""
    if not MASSING_FILE.exists():
        raise FileNotFoundError(
            f"Toronto 3D Massing snapshot is missing: {MASSING_FILE}. "
            "Restore backend/data/york_building_heights.geojson before starting the backend."
        )

    raw = gpd.read_file(MASSING_FILE)
    required = {"MAX_HEIGHT", "HEIGHT_SRC", "geometry"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"Toronto 3D Massing snapshot is missing columns: {sorted(missing)}")

    buildings = raw[raw.geometry.type.isin(["Polygon", "MultiPolygon"])].copy()
    buildings = buildings.explode(index_parts=False)
    buildings.geometry = shapely.force_2d(buildings.geometry.array)
    buildings["height_m"] = buildings["MAX_HEIGHT"].astype(float)
    buildings["height_source"] = f"toronto_3d_massing_{MASSING_YEAR}"
    buildings["height_data_source"] = buildings["HEIGHT_SRC"].fillna("unknown")
    return buildings[
        ["geometry", "height_m", "height_source", "height_data_source", "SURF_ELEV"]
    ].to_crs(METRIC_CRS)


def _fetch_campus_polygon() -> BaseGeometry:
    gdf = ox.geocode_to_gdf([f"W{CAMPUS_OSM_WAY}"], by_osmid=True)
    return gdf.to_crs(METRIC_CRS).geometry.iloc[0]


def load_campus(refresh: bool = False) -> CampusData:
    """Download (or load from cache) the full Keele campus walk graph, buildings and trees."""
    CACHE_DIR.mkdir(exist_ok=True)
    graph_f, bld_f, tree_f, poly_f = (
        CACHE_DIR / n for n in ("walk.graphml", "toronto_buildings.gpkg", "trees.gpkg", "campus.gpkg")
    )

    if not refresh and all(f.exists() for f in (graph_f, bld_f, tree_f, poly_f)):
        graph = ox.load_graphml(graph_f)
        buildings = gpd.read_file(bld_f)
        buildings.geometry = shapely.force_2d(buildings.geometry.array)
        if "SURF_ELEV" not in buildings:
            buildings = _load_massing_buildings()
        assign_node_elevations(graph, buildings)
        annotate_graph_edges(graph)
        return CampusData(
            graph,
            buildings,
            gpd.read_file(tree_f),
            gpd.read_file(poly_f).geometry.iloc[0],
        )

    campus = _fetch_campus_polygon()
    to_wgs84 = lambda geom: gpd.GeoSeries([geom], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]

    graph = _with_retries(lambda: ox.graph_from_polygon(
        to_wgs84(campus.buffer(GRAPH_BUFFER_M)), network_type="walk", truncate_by_edge=True
    ))
    graph = ox.project_graph(graph, to_crs=METRIC_CRS)

    buildings = _load_massing_buildings()
    assign_node_elevations(graph, buildings)
    annotate_graph_edges(graph)
    shadow_zone = to_wgs84(campus.buffer(max(SHADOW_BUFFER_M, MAX_SHADOW_LENGTH_M)))

    try:
        raw_trees = _with_retries(lambda: ox.features_from_polygon(shadow_zone, tags={"natural": "tree"}))
        trees = raw_trees[raw_trees.geometry.type == "Point"].to_crs(METRIC_CRS)[["geometry"]].reset_index(drop=True)
    except Exception:  # osmnx raises if no features match (or all mirrors failed)
        trees = gpd.GeoDataFrame({"geometry": []}, geometry="geometry", crs=METRIC_CRS)

    ox.save_graphml(graph, graph_f)
    buildings.to_file(bld_f, driver="GPKG")
    trees.to_file(tree_f, driver="GPKG")
    gpd.GeoDataFrame({"geometry": [campus]}, crs=METRIC_CRS).to_file(poly_f, driver="GPKG")
    return CampusData(graph, buildings, trees, campus)


def building_list(data: CampusData) -> list[tuple[Polygon, float]]:
    """(footprint, height_m) pairs in the form shadow_union() expects."""
    return list(zip(data.buildings.geometry, data.buildings.height_m))


def tree_list(data: CampusData) -> list[tuple[float, float]]:
    """(x, y) tree centres in the form ShadowCaster expects."""
    return [(p.x, p.y) for p in data.trees.geometry]


def campus_origin(data: CampusData) -> tuple[float, float]:
    """Campus centre in projected metres (useful for plotting)."""
    pt = gpd.GeoSeries.from_xy([CAMPUS_CENTER[1]], [CAMPUS_CENTER[0]], crs="EPSG:4326").to_crs(METRIC_CRS).iloc[0]
    return pt.x, pt.y
