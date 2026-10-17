"""HTTP API for the frontend.

Run from the repo root:   uvicorn backend.api:app --reload --port 8000
Interactive docs:          http://localhost:8000/docs
Demo page (no Next needed): http://localhost:8000/demo

Endpoints
    GET /route    fastest route vs ContextRoute for the fixed demo trip, at a given date/time
    GET /shadows  building shadows (GeoJSON) at a given date/time, to draw on the map
    GET /health

All geometry is GeoJSON in WGS84 (longitude, latitude), which Leaflet/MapLibre read directly.
Date/time are interpreted as Toronto local time.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import date as Date, datetime, time as Time
from pathlib import Path
from zoneinfo import ZoneInfo

import numpy as np
import shapely
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pyproj import Transformer
from shapely.geometry import LineString, mapping

from .data import CAMPUS_CENTER, METRIC_CRS, CampusData, load_campus
from .exposure import ExposureModel, SunSchedule
from .router import NoRouteError, RouteResult, compare
from .trip import DEST, ORIGIN, nearest_node

TZ = ZoneInfo("America/Toronto")
STATIC_DIR = Path(__file__).parent / "static"
_transformer = Transformer.from_crs(METRIC_CRS, "EPSG:4326", always_xy=True)


def _to_wgs84(geom):
    """Metric-CRS shapely geometry -> lon/lat."""
    return shapely.transform(geom, lambda c: np.column_stack(_transformer.transform(c[:, 0], c[:, 1])))


# --- response models --------------------------------------------------------

class RouteOut(BaseModel):
    seconds: float
    distance_m: float
    sun_percent: float
    sun_seconds: float
    geometry: dict  # GeoJSON LineString, [lon, lat]


class SunOut(BaseModel):
    elevation_deg: float
    azimuth_deg: float
    is_daylight: bool


class RouteResponse(BaseModel):
    when: str
    w_sun: float
    cloud_cover: float
    sun: SunOut
    origin: tuple[float, float]       # (lat, lon)
    destination: tuple[float, float]  # (lat, lon)
    fastest: RouteOut
    contextroute: RouteOut
    extra_seconds: float
    sun_percent_change: float  # percentage points: contextroute - fastest


# --- state ------------------------------------------------------------------

class State:
    data: CampusData
    base: ExposureModel
    origin: int
    dest: int
    models: dict[tuple[Date, float], ExposureModel]


state = State()


@asynccontextmanager
async def lifespan(_: FastAPI):
    state.data = load_campus()
    first_day = datetime.now(TZ)
    state.base = ExposureModel(state.data, SunSchedule(*CAMPUS_CENTER, first_day))
    state.origin = nearest_node(state.data.graph, ORIGIN)
    state.dest = nearest_node(state.data.graph, DEST)
    state.models = {}
    yield


app = FastAPI(title="ContextRoute backend", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


# --- helpers ----------------------------------------------------------------

def _parse_when(day: Date | None, clock: Time | None) -> datetime:
    now = datetime.now(TZ)
    day = day or now.date()
    clock = clock or now.time().replace(second=0, microsecond=0)
    return datetime.combine(day, clock, tzinfo=TZ)


def _model_for(when: datetime, cloud_cover: float) -> ExposureModel:
    key = (when.date(), round(cloud_cover, 2))
    model = state.models.get(key)
    if model is None:
        if len(state.models) > 32:
            state.models.clear()
        model = state.base.with_sun(SunSchedule(*CAMPUS_CENTER, when, cloud_cover))
        state.models[key] = model
    return model


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
        geometry=_route_geometry(model, r),
    )


# --- endpoints --------------------------------------------------------------

@app.get("/health")
def health() -> dict:
    return {"status": "ok", "edges": len(state.base.edges), "buildings": len(state.data.buildings)}


@app.get("/route", response_model=RouteResponse)
def get_route(
    date: Date | None = Query(None, description="YYYY-MM-DD (default: today)"),
    time: Time | None = Query(None, description="HH:MM, 24 h (default: now)"),
    w_sun: float = Query(3.0, ge=0, le=50, description="Sun-avoidance weight; 0 = fastest route"),
    cloud_cover: float = Query(0.0, ge=0, le=1, description="0 clear sky .. 1 overcast"),
) -> RouteResponse:
    when = _parse_when(date, time)
    model = _model_for(when, cloud_cover)
    try:
        fast, ctx = compare(model, state.origin, state.dest, when, w_sun)
    except NoRouteError as exc:
        raise HTTPException(404, str(exc))
    sun = model.sun.position(when)
    return RouteResponse(
        when=when.isoformat(),
        w_sun=w_sun,
        cloud_cover=cloud_cover,
        sun=SunOut(elevation_deg=round(sun.elevation, 2), azimuth_deg=round(sun.azimuth, 2),
                   is_daylight=sun.is_up),
        origin=ORIGIN,
        destination=DEST,
        fastest=_route_out(model, fast),
        contextroute=_route_out(model, ctx),
        extra_seconds=round(ctx.seconds - fast.seconds, 1),
        sun_percent_change=round(ctx.sun_percent - fast.sun_percent, 1),
    )


@app.get("/shadows")
def get_shadows(
    date: Date | None = Query(None, description="YYYY-MM-DD (default: today)"),
    time: Time | None = Query(None, description="HH:MM, 24 h (default: now)"),
) -> dict:
    """GeoJSON FeatureCollection of the combined building shadow (empty at night)."""
    when = _parse_when(date, time)
    model = _model_for(when, 0.0)
    shadow = model.shadow_at(when).simplify(0.5)
    features = []
    if not shadow.is_empty:
        features.append({"type": "Feature", "properties": {},
                         "geometry": mapping(_to_wgs84(shadow))})
    return {"type": "FeatureCollection", "features": features}


@app.get("/demo", include_in_schema=False)
def demo_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "demo.html")
