# ContextRoute backend (Python)

Sun/shadow math, the walk graph for York's Keele campus, and an A*/Dijkstra router whose edge cost
includes sun exposure. Served to the frontend over HTTP by FastAPI.

## Run it

```
pip install -r requirements.txt
uvicorn backend.api:app --reload --port 8000
```

- Interactive API docs: http://localhost:8000/docs
- Standalone demo page (date/time controls, map, routes, shadows): http://localhost:8000/demo
- Tests: `python -m pytest backend`

## How the frontend connects

```
 Next.js (localhost:3000)                        FastAPI (localhost:8000)
 ┌───────────────────────┐   GET /route?date&time&w_sun&cloud_cover   ┌────────────────────────┐
 │ react-leaflet map     │ ─────────────────────────────────────────► │ ExposureModel + router │
 │ date/time/slider UI   │ ◄───────────────────────────────────────── │ (A* with sun cost)     │
 │                       │   JSON: stats + GeoJSON LineStrings         │                        │
 │                       │   GET /shadows?date&time                    │ ShadowCaster           │
 │                       │ ─────────────────────────────────────────► │                        │
 │                       │ ◄───────────── GeoJSON shadow polygons ─────│                        │
 └───────────────────────┘                                             └────────────────────────┘
```

The frontend never does routing or sun math. It sends the date, time and weights, and draws what comes back.
The backend allows CORS from `http://localhost:3000`.

### `GET /route`

Query: `date` (YYYY-MM-DD), `time` (HH:MM, Toronto local), `w_sun` (0-50, default 3; 0 = fastest),
`cloud_cover` (0-1). Currently always the fixed demo trip in `backend/trip.py`.

Response (abridged):

```json
{
  "when": "2026-06-21T14:00:00-04:00",
  "sun": {"elevation_deg": 68.06, "azimuth_deg": 205.31, "is_daylight": true},
  "origin": [43.7715, -79.51], "destination": [43.779, -79.496],
  "fastest":      {"seconds": 1177.7, "distance_m": 1648.8, "sun_percent": 95.1, "geometry": {"type": "LineString", "coordinates": [[-79.51, 43.77], "..."]}},
  "contextroute": {"seconds": 1428.4, "distance_m": 1999.8, "sun_percent": 61.7, "geometry": {"type": "LineString", "coordinates": ["..."]}},
  "extra_seconds": 250.7,
  "sun_percent_change": -33.4
}
```

`origin`/`destination` are `[lat, lon]`. GeoJSON coordinates are `[lon, lat]`.

### `GET /shadows`

Query: `date`, `time`. Returns a GeoJSON FeatureCollection with the combined building and tree shadow (empty at night).
Draw it as a semi-transparent polygon layer under the routes.

### Drawing it in react-leaflet

`<GeoJSON>` does not redraw when its `data` prop changes, so give it a `key` that changes with the request:

```tsx
<GeoJSON key={`fast-${when}`} data={route.fastest.geometry} style={{ color: "#d1342f", weight: 5 }} />
<GeoJSON key={`ctx-${when}`}  data={route.contextroute.geometry} style={{ color: "#1f8f3a", weight: 5 }} />
<GeoJSON key={`shadow-${when}`} data={shadows} style={{ weight: 0, fillOpacity: 0.35 }} />
```

Debounce the date/time/slider input (about 150 ms) and ignore responses from superseded requests;
`backend/static/demo.html` does both.

## Pipeline

```
date/time -> sun position (pvlib) -> building shadows (ShadowCaster)
          -> shade fraction per walkway edge -> sun-seconds per edge (trapezoid integral)
          -> edge cost = w_time * seconds + w_sun * sun_seconds -> A*
```

| File | Role |
|---|---|
| `sun.py` | sun elevation/azimuth (pvlib, plus a textbook formula for explanation) |
| `shadow.py` | `L = h / tan(theta)`, building shadow by sweeping the footprint; tree canopy shadows |
| `data.py` | OSM campus polygon, walk graph, buildings, trees (cached in `backend/cache/`) |
| `exposure.py` | per-edge shade fraction and sun-exposure integral |
| `router.py` | A*/Dijkstra with the multi-objective cost, closed-edge constraints |
| `api.py` | FastAPI endpoints |

## Assumptions (for the judges' explanation)

- Flat ground; building heights from OSM `height`, else `building:levels * 3 m`, else a per-type default.
- Shadows are not computed when the sun is below 3 degrees, and shadow length is capped at 300 m.
- Shade fraction is measured at sample points 1.5 m apart along each edge, using the nearest 15-minute shadow.
  This matches exact geometry to within about 0.2% (length-weighted).
- Walking speed 1.4 m/s. Sun intensity is `sin(elevation)`, scaled by Kasten-Czeplak cloud transmission.
- Edges through building footprints count as fully shaded (indoor connections).
- Trees (OSM `natural=tree` points) have no size data, so each is a canopy disk of radius 3 m from 2 m to 9 m up
  (constants in `shadow.py`). Its shadow is the hull of the crown shifted by `2 m / tan(theta)` and `9 m / tan(theta)`,
  so the ground under a tree is only shaded when the sun is high. The trunk is ignored.
- Elevation and rain are not modelled yet.
- The time-dependent search settles nodes by accumulated cost, which is exact only if arriving earlier never
  makes the rest of the walk costlier. Walks last minutes and the sun moves slowly, so the error is negligible.
