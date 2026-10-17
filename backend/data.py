"""Load York University (Keele campus) map data from OpenStreetMap via OSMnx.

The campus extent is the official OSM polygon "York University, Keele Campus"
(way 15396822, ~1.9 km^2). The walk network is loaded for that polygon plus a
small buffer so routes can start/end just outside it. Buildings and trees are
loaded for a wider buffer (SHADOW_BUFFER_M) because off-campus buildings can
cast shadows onto campus paths.

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
from shapely.geometry import Polygon
from shapely.geometry.base import BaseGeometry

from .shadow import MAX_SHADOW_LENGTH_M, height_from_osm

CAMPUS_CENTER = (43.7735, -79.5019)  # (lat, lon) approx. Vari Hall; used for sun position
CAMPUS_OSM_WAY = 15396822            # "York University, Keele Campus"
METRIC_CRS = "EPSG:32617"
GRAPH_BUFFER_M = 100.0   # walk network extends this far past the campus boundary
SHADOW_BUFFER_M = 300.0  # buildings this far out can shade campus (= MAX_SHADOW_LENGTH_M)

CACHE_DIR = Path(__file__).parent / "cache"

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


def _building_heights(raw: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    gdf = raw[raw.geometry.type.isin(["Polygon", "MultiPolygon"])].copy()
    gdf = gdf.explode(index_parts=False)  # MultiPolygon -> Polygon rows

    def source(row) -> str:
        if "height" in row and row["height"] == row["height"]:
            return "height"
        if "building:levels" in row and row["building:levels"] == row["building:levels"]:
            return "levels"
        return "type_default"

    cols = [c for c in ("height", "building:levels", "building") if c in gdf.columns]
    gdf["height_source"] = gdf.apply(source, axis=1)
    gdf["height_m"] = [
        height_from_osm({k: v for k, v in row.items() if k in cols and v == v})
        for row in gdf[cols].to_dict("records")
    ]
    return gdf[["geometry", "height_m", "height_source"]].reset_index(drop=True)


def _fetch_campus_polygon() -> BaseGeometry:
    gdf = ox.geocode_to_gdf([f"W{CAMPUS_OSM_WAY}"], by_osmid=True)
    return gdf.to_crs(METRIC_CRS).geometry.iloc[0]


def load_campus(refresh: bool = False) -> CampusData:
    """Download (or load from cache) the full Keele campus walk graph, buildings and trees."""
    CACHE_DIR.mkdir(exist_ok=True)
    graph_f, bld_f, tree_f, poly_f = (
        CACHE_DIR / n for n in ("walk.graphml", "buildings.gpkg", "trees.gpkg", "campus.gpkg")
    )

    if not refresh and all(f.exists() for f in (graph_f, bld_f, tree_f, poly_f)):
        return CampusData(
            ox.load_graphml(graph_f),
            gpd.read_file(bld_f),
            gpd.read_file(tree_f),
            gpd.read_file(poly_f).geometry.iloc[0],
        )

    campus = _fetch_campus_polygon()
    to_wgs84 = lambda geom: gpd.GeoSeries([geom], crs=METRIC_CRS).to_crs("EPSG:4326").iloc[0]

    graph = _with_retries(lambda: ox.graph_from_polygon(
        to_wgs84(campus.buffer(GRAPH_BUFFER_M)), network_type="walk", truncate_by_edge=True
    ))
    graph = ox.project_graph(graph, to_crs=METRIC_CRS)

    shadow_zone = to_wgs84(campus.buffer(max(SHADOW_BUFFER_M, MAX_SHADOW_LENGTH_M)))
    raw_buildings = _with_retries(lambda: ox.features_from_polygon(shadow_zone, tags={"building": True}))
    buildings = _building_heights(raw_buildings.to_crs(METRIC_CRS))

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


def campus_origin(data: CampusData) -> tuple[float, float]:
    """Campus centre in projected metres (useful for plotting)."""
    pt = gpd.GeoSeries.from_xy([CAMPUS_CENTER[1]], [CAMPUS_CENTER[0]], crs="EPSG:4326").to_crs(METRIC_CRS).iloc[0]
    return pt.x, pt.y
