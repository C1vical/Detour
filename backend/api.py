"""HTTP API for the frontend.

Run from the repo root:   uvicorn backend.api:app --reload --port 8000
Interactive docs:          http://localhost:8000/docs
Demo page (no Next needed): http://localhost:8000/demo

Endpoints
    GET /route    fastest route vs ContextRoute (demo trip by default, or between clicked points), at a given date/time
    GET /shadows  building shadows (GeoJSON) at a given date/time, to draw on the map
    GET /campus   the campus boundary (GeoJSON); pins outside it are rejected
    GET /health

All geometry is GeoJSON in WGS84 (longitude, latitude), which Leaflet/MapLibre read directly.
Date/time are interpreted as Toronto local time.
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import date as Date, datetime, time as Time
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import shapely
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel
from pyproj import Transformer
from shapely.geometry import LineString, mapping

from .data import CAMPUS_CENTER, METRIC_CRS, CampusData, load_campus
from .exposure import ExposureModel, SunSchedule
from .router import NoRouteError, RouteResult, pick, route, shade_options
from .trip import DEST, ORIGIN, nearest_node
from .weather import day_weather

TZ = ZoneInfo("America/Toronto")
STATIC_DIR = Path(__file__).parent / "static"
_transformer = Transformer.from_crs(METRIC_CRS, "EPSG:4326", always_xy=True)
_to_metric = Transformer.from_crs("EPSG:4326", METRIC_CRS, always_xy=True)
MAX_SNAP_M = 150.0  # a clicked point farther than this from any path is rejected
# Supported dates; far outside this, datetime.timestamp() fails on some platforms.
MIN_DATE, MAX_DATE = Date(1900, 1, 1), Date(2100, 12, 31)
LOCAL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]  # the Next.js dev server


def _to_wgs84(geom):
    """Metric-CRS shapely geometry -> lon/lat."""
    return shapely.transform(geom, lambda c: np.column_stack(_transformer.transform(c[:, 0], c[:, 1])))


# --- response models --------------------------------------------------------

class RouteOut(BaseModel):
    seconds: float
    distance_m: float
    sun_percent: float
    sun_seconds: float
    rain_percent: float
    geometry: dict  # GeoJSON LineString, [lon, lat]


class SunOut(BaseModel):
    elevation_deg: float
    azimuth_deg: float
    is_daylight: bool


class WeatherOut(BaseModel):
    source: str                 # "live" (Open-Meteo), "clear_sky" (forced), "unavailable" (fetch failed)
    direct_wm2: float | None    # direct sunlight on the ground at `when`
    cloud_cover: float | None   # 0-1
    rain_mm_h: float | None


class RouteResponse(BaseModel):
    when: str
    sun_avoidance: float
    w_rain: float
    route_options: int  # how many time/shade trade-offs this trip has; the slider picks one
    weather: WeatherOut
    sun: SunOut
    origin: tuple[float, float]       # (lat, lon)
    destination: tuple[float, float]  # (lat, lon)
    fastest: RouteOut
    contextroute: RouteOut
    extra_seconds: float
    sun_percent_change: float  # percentage points: contextroute - fastest
    rain_percent_change: float  # percentage points: contextroute - fastest


# --- state ------------------------------------------------------------------

class State:
    data: CampusData
    base: ExposureModel
    origin: int
    dest: int
    models: dict[tuple[Date, bool], ExposureModel]
    options: dict[tuple, tuple[RouteResult, list[RouteResult]]]
    shadows: dict[int, bytes]  # /shadows response body per time slice


state = State()


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.data = load_campus()
    first_day = datetime.now(TZ)
    state.base = ExposureModel(state.data, SunSchedule(*CAMPUS_CENTER, first_day))
    state.origin = nearest_node(state.data.graph, ORIGIN)
    state.dest = nearest_node(state.data.graph, DEST)
    state.models = {}
    state.options = {}
    state.shadows = {}
    yield


def allowed_origins(env=os.environ) -> list[str]:
    """Sites allowed to call the API: local dev, plus ALLOWED_ORIGINS (comma-separated,
    e.g. the Vercel URL) when deployed."""
    extra = [o.strip().rstrip("/") for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    return LOCAL_ORIGINS + extra


app = FastAPI(title="ContextRoute backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins(),
    # Optional, e.g. https://detour-.*\.vercel\.app to also allow Vercel preview deployments.
    allow_origin_regex=os.environ.get("ALLOWED_ORIGIN_REGEX") or None,
    allow_methods=["GET"],
    allow_headers=["*"],
)


# --- helpers ----------------------------------------------------------------

def _parse_when(day: Date | None, clock: Time | None) -> datetime:
    now = datetime.now(TZ)
    day = day or now.date()
    if not MIN_DATE <= day <= MAX_DATE:
        raise HTTPException(422, f"date must be between {MIN_DATE} and {MAX_DATE}")
    clock = clock or now.time().replace(second=0, microsecond=0)
    return datetime.combine(day, clock, tzinfo=TZ)


def _model_for(when: datetime, clear_sky: bool) -> ExposureModel:
    """Model for that date: live weather (re-fetched every 30 min), or a clear, dry sky."""
    weather = None if clear_sky else day_weather(*CAMPUS_CENTER, when.date())
    key = (when.date(), clear_sky)
    model = state.models.get(key)
    if model is None or model.sun.weather is not weather:
        if len(state.models) > 32:
            state.models.clear()
        model = state.base.with_sun(SunSchedule(*CAMPUS_CENTER, when, weather))
        state.models[key] = model
    return model


def _options_for(model: ExposureModel, origin: int, dest: int, when: datetime,
                 w_rain: float) -> tuple[RouteResult, list[RouteResult]]:
    """(fastest route, shade options) for a trip, cached so moving the avoidance slider is instant."""
    key = (model, origin, dest, when, w_rain)
    hit = state.options.get(key)
    if hit is None:
        if len(state.options) > 64:
            state.options.clear()
        hit = (route(model, origin, dest, when), shade_options(model, origin, dest, when, w_rain))
        state.options[key] = hit
    return hit


def _weather_out(model: ExposureModel, when: datetime, clear_sky: bool) -> WeatherOut:
    weather = model.sun.weather
    if weather is None:
        return WeatherOut(source="clear_sky" if clear_sky else "unavailable",
                          direct_wm2=None, cloud_cover=None, rain_mm_h=None)
    direct, cloud, rain = weather.at(when)
    return WeatherOut(source="live", direct_wm2=round(direct), cloud_cover=round(cloud, 2),
                      rain_mm_h=round(rain, 1))


def _snap(name: str, latlon: tuple[float, float]) -> int:
    """Nearest walk-graph node to a (lat, lon), or 422 if the point is off campus or off the network."""
    x, y = _to_metric.transform(latlon[1], latlon[0])
    if not shapely.contains_xy(state.data.campus, x, y):
        raise HTTPException(422, f"{name} is outside York University's Keele Campus")
    node = nearest_node(state.data.graph, latlon)
    nd = state.data.graph.nodes[node]
    if np.hypot(nd["x"] - x, nd["y"] - y) > MAX_SNAP_M:
        raise HTTPException(422, f"{name} is too far from any walkable path")
    return node


def _route_geometry(model: ExposureModel, result: RouteResult) -> dict:
    coords: list[tuple[float, float]] = []
    for ei in result.edges:
        pts = list(model.edge_line(ei).coords)
        coords.extend(pts if not coords else pts[1:])
    return mapping(_to_wgs84(LineString(coords)))


def _route_out(model: ExposureModel, r: RouteResult) -> RouteOut:
    return RouteOut(
        seconds=round(r.seconds, 1),
        distance_m=round(r.distance_m, 1),
        sun_percent=round(r.sun_percent, 1),
        sun_seconds=round(r.sun_seconds, 1),
        rain_percent=round(r.rain_percent, 1),
        geometry=_route_geometry(model, r),
    )


# --- endpoints --------------------------------------------------------------

# HEAD too: uptime monitors (e.g. UptimeRobot) check with HEAD and count a 405 as down.
@app.api_route("/health", methods=["GET", "HEAD"])
def health() -> dict:
    return {"status": "ok", "edges": len(state.base.edges), "buildings": len(state.data.buildings)}


@app.get("/campus")
def get_campus() -> dict:
    """GeoJSON Feature with the Keele campus boundary; /route only accepts pins inside it."""
    return {"type": "Feature", "properties": {"name": "York University, Keele Campus"},
            "geometry": mapping(_to_wgs84(state.data.campus))}


@app.get("/route", response_model=RouteResponse)
def get_route(
    date: Date | None = Query(None, description="YYYY-MM-DD (default: today)"),
    time: Time | None = Query(None, description="HH:MM, 24 h (default: now)"),
    sun_avoidance: float = Query(50.0, ge=0, le=100,
                                 description="% of the avoidable sun to avoid; 0 = fastest, 100 = shadiest"),
    w_rain: float = Query(0.0, ge=0, le=50, description="Rain-avoidance weight; only matters while it rains"),
    clear_sky: bool = Query(False, description="Ignore live weather: clear, dry sky (for demos)"),
    from_lat: float | None = Query(None, ge=-90, le=90, description="Start latitude (default: demo start)"),
    from_lon: float | None = Query(None, ge=-180, le=180, description="Start longitude"),
    to_lat: float | None = Query(None, ge=-90, le=90, description="End latitude (default: demo end)"),
    to_lon: float | None = Query(None, ge=-180, le=180, description="End longitude"),
) -> RouteResponse:
    if (from_lat is None) != (from_lon is None) or (to_lat is None) != (to_lon is None):
        raise HTTPException(422, "give both lat and lon for each of from/to")
    origin = ORIGIN if from_lat is None else (from_lat, from_lon)
    dest = DEST if to_lat is None else (to_lat, to_lon)
    origin_node = state.origin if from_lat is None else _snap("start", origin)
    dest_node = state.dest if to_lat is None else _snap("end", dest)
    when = _parse_when(date, time)
    model = _model_for(when, clear_sky)
    try:
        fast, options = _options_for(model, origin_node, dest_node, when, w_rain)
    except NoRouteError as exc:
        raise HTTPException(404, str(exc))
    ctx = pick(options, sun_avoidance / 100)
    sun = model.sun.position(when)
    return RouteResponse(
        when=when.isoformat(),
        sun_avoidance=sun_avoidance,
        w_rain=w_rain,
        route_options=len(options),
        weather=_weather_out(model, when, clear_sky),
        sun=SunOut(elevation_deg=round(sun.elevation, 2), azimuth_deg=round(sun.azimuth, 2),
                   is_daylight=sun.is_up),
        origin=origin,
        destination=dest,
        fastest=_route_out(model, fast),
        contextroute=_route_out(model, ctx),
        extra_seconds=round(ctx.seconds - fast.seconds, 1),
        sun_percent_change=round(ctx.sun_percent - fast.sun_percent, 1),
        rain_percent_change=round(ctx.rain_percent - fast.rain_percent, 1),
    )


@app.get("/shadows")
def get_shadows(
    date: Date | None = Query(None, description="YYYY-MM-DD (default: today)"),
    time: Time | None = Query(None, description="HH:MM, 24 h (default: now)"),
) -> Response:
    """GeoJSON FeatureCollection of the building and tree shadows (no features at night).

    One MultiPolygon of overlapping pieces, not their union: the union takes seconds
    per time slice, the pieces milliseconds. Draw it with fill-rule nonzero (Leaflet:
    fillRule: "nonzero") and it looks the same as the union.
    """
    when = _parse_when(date, time)
    model = _model_for(when, clear_sky=True)  # shadow geometry doesn't depend on weather
    key = model.slice_index(when)
    body = state.shadows.get(key)
    if body is None:
        pieces = model.shadow_pieces_at(when)
        features = ""
        if len(pieces):
            # 6 decimals of a degree is about 0.1 m, plenty for drawing and 40 % smaller.
            geometry = shapely.transform(_to_wgs84(shapely.multipolygons(pieces)), lambda c: np.round(c, 6))
            features = f'{{"type":"Feature","properties":{{}},"geometry":{shapely.to_geojson(geometry)}}}'
        body = f'{{"type":"FeatureCollection","features":[{features}]}}'.encode()
        if len(state.shadows) > 192:
            state.shadows.clear()
        state.shadows[key] = body
    return Response(body, media_type="application/json")


@app.get("/demo", include_in_schema=False)
def demo_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "demo.html")
