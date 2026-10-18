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
 ┌───────────────────────┐   GET /route?date&time&w_sun&w_rain&pins   ┌────────────────────────┐
 │ react-leaflet map     │ ─────────────────────────────────────────► │ ExposureModel + router │
 │ date/time/slider UI   │ ◄───────────────────────────────────────── │ (sun + rain cost)      │
 │                       │   JSON: stats + GeoJSON LineStrings         │                        │
 │                       │   GET /shadows?date&time                    │ ShadowCaster           │
 │                       │ ─────────────────────────────────────────► │                        │
 │                       │ ◄───────────── GeoJSON shadow polygons ─────│                        │
 └───────────────────────┘                                             └───────────┬────────────┘
                                                        hourly weather (30-min cache) │
                                                                  Open-Meteo API ◄───┘
```

The frontend never does routing, sun or weather math. It sends the date, time and weights,
and draws what comes back, including the weather the backend used.
The backend allows CORS from `http://localhost:3000`.

### `GET /route`

Query: `date` (YYYY-MM-DD), `time` (HH:MM, Toronto local), `w_sun` (0-50, default 3; 0 = fastest),
`w_rain` (0-50, default 0), optional `from_lat/from_lon/to_lat/to_lon` pins (default: the demo trip in `backend/trip.py`),
and a hidden `clear_sky=true` that ignores live weather (clear, dry sky) for demos on overcast days.

Response (abridged):

```json
{
  "when": "2026-06-21T14:00:00-04:00",
  "weather": {"source": "live", "direct_wm2": 604, "cloud_cover": 0.7, "rain_mm_h": 0.0},
  "sun": {"elevation_deg": 68.06, "azimuth_deg": 205.31, "is_daylight": true},
  "origin": [43.7715, -79.51], "destination": [43.779, -79.496],
  "fastest":      {"seconds": 1177.7, "distance_m": 1648.8, "sun_percent": 95.1, "geometry": {"type": "LineString", "coordinates": [[-79.51, 43.77], "..."]}},
  "contextroute": {"seconds": 1428.4, "distance_m": 1999.8, "sun_percent": 61.7, "geometry": {"type": "LineString", "coordinates": ["..."]}},
  "extra_seconds": 250.7,
  "sun_percent_change": -33.4,
  "rain_percent_change": 0.0
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
date      -> Open-Meteo hourly direct radiation + precipitation -> sun intensity, rain intensity
             roofs (buildings, covered/indoor ways) -> shelter fraction per edge -> rain-seconds per edge
          -> edge cost = w_time * seconds + w_sun * sun_seconds + w_rain * rain_seconds -> A*/Dijkstra
```

| File | Role |
|---|---|
| `sun.py` | sun elevation/azimuth (pvlib) |
| `shadow.py` | `L = h / tan(theta)`; building shadows by sweeping the footprint; tree canopy shadows |
| `data.py` | OSM campus polygon, walk graph and trees; Toronto 3D Massing buildings (cached in `backend/cache/`) |
| `weather.py` | Open-Meteo client: hourly direct radiation, cloud cover, precipitation for a date (cached 30 min) |
| `exposure.py` | per-edge shade and shelter fractions; sun- and rain-exposure integrals |
| `router.py` | A*/Dijkstra with the multi-objective cost |
| `api.py` | FastAPI endpoints |

## Assumptions (for the judges' explanation)

- Building heights come from the City of Toronto 3D Massing snapshot (`backend/data/`).
- Flat ground and a constant walking speed of 1.4 m/s.
- Shadows are not computed when the sun is below 3 degrees, and shadow length is capped at 300 m.
- Shade fraction is measured at sample points 1.5 m apart along each edge, using the nearest 15-minute shadow.
  This matches exact geometry to within about 0.2% (length-weighted).
- Sun intensity is Open-Meteo's forecast **direct** radiation / 1000 W/m². Shade only blocks the direct beam (diffuse
  skylight reaches you in the shade too), so under full overcast there is nothing to avoid. If the weather can't be
  fetched, or `clear_sky=true`, intensity falls back to a clear sky, `sin(elevation)`.
- Open-Meteo radiation and precipitation are averages over the hour ending at each timestamp, so they are placed at
  the middle of that hour and interpolated to the minute.
- Rain intensity is `min(1, mm/h / 4)`: moderate rain (4 mm/h) or heavier counts as 1.
- Shelter: an edge's share of 1.5 m sample points inside a building footprint, or 1 for walkways tagged
  `covered=yes`, `indoor=yes`, `highway=corridor` or `tunnel=building_passage`. Wind-blown rain is ignored.
- Edges through building footprints count as fully shaded and sheltered (indoor connections).
- Trees (OSM `natural=tree` points) have no size data, so each is a canopy disk of radius 3 m from 2 m to 9 m up
  (constants in `shadow.py`). Its shadow is the hull of the crown shifted by `2 m / tan(theta)` and `9 m / tan(theta)`,
  so the ground under a tree is only shaded when the sun is high. The trunk is ignored.
- The time-dependent search settles nodes by accumulated cost, which is exact only if arriving earlier never
  makes the rest of the walk costlier. Walks last minutes and the sun moves slowly, so the error is negligible.
