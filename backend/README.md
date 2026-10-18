# Detour backend (Python)

Sun/shadow math, the walk graph for York's Keele campus, and the router. For each trip it finds every sensible
trade of walking time for shade (a bicriteria A* search) and the sun-avoidance setting picks one; optional rain
avoidance keeps the route under roofs while it rains. Served to the frontend over HTTP by FastAPI.

## Run it

```
pip install -r requirements.txt
uvicorn backend.api:app --reload --port 8000
```

Or, from the repo root, `npm run setup` once and then `npm run dev`, which runs this together with the frontend.

Interactive API docs: http://localhost:8000/docs

## How the frontend connects

```
 Next.js (localhost:3000)                        FastAPI (localhost:8000)
 ┌───────────────────────┐   GET /route?date&time&sun_avoidance&...  ┌────────────────────────┐
 │ react-leaflet map     │ ─────────────────────────────────────────► │ ExposureModel + router │
 │ date/time/slider UI   │ ◄───────────────────────────────────────── │ (sun + rain exposure)  │
 │                       │   JSON: stats + GeoJSON LineStrings         │                        │
 │                       │   GET /shadows?date&time                    │ ShadowCaster           │
 │                       │ ─────────────────────────────────────────► │                        │
 │                       │ ◄───────────── GeoJSON shadow polygons ─────│                        │
 └───────────────────────┘                                             └───────────┬────────────┘
                                                        hourly weather (30-min cache) │
                                                                  Open-Meteo API ◄───┘
```

The frontend never does routing, sun or weather math. It sends the date, time and settings,
and draws what comes back, including the weather the backend used.
The backend allows CORS from `http://localhost:3000` and `http://127.0.0.1:3000`, plus the sites listed in the
`ALLOWED_ORIGINS` env var (comma-separated) and `ALLOWED_ORIGIN_REGEX` when deployed; see "Deploying" in the
top-level README.

### `GET /route`

Query: `date` (YYYY-MM-DD, 1900-01-01 to 2100-12-31; 422 outside), `time` (HH:MM, Toronto local),
`sun_avoidance` (0-100 %, default 50; 0 = fastest, 100 = shadiest, see below),
`w_rain` (0-50, default 0; the frontend sends 10 when "Avoid rain" is on),
optional `from_lat/from_lon/to_lat/to_lon` pins (default: the demo trip in `backend/trip.py`),
and `clear_sky=true`, which ignores live weather (clear, dry sky); the frontend doesn't use it.

A pin outside the campus boundary is answered with 422. Any pin inside it snaps to the nearest walkway node, however
far away (the walk graph is one strongly connected component, so every pair of pins has a route); the frontend draws
a dotted line from each pin to its route. Time and distance count only the walkway part. If both pins snap to the
same node, both routes are a zero-length line at that node.

Response for the demo trip on 21 June 2026 at 14:00 (geometry shortened):

```json
{
  "when": "2026-06-21T14:00:00-04:00",
  "sun_avoidance": 50.0, "w_rain": 0.0, "route_options": 9,
  "weather": {"source": "live", "direct_wm2": 604.0, "cloud_cover": 0.7, "rain_mm_h": 0.0},
  "sun": {"elevation_deg": 68.06, "azimuth_deg": 205.31, "is_daylight": true},
  "origin": [43.7715, -79.51], "destination": [43.779, -79.496],
  "fastest":      {"seconds": 1177.7, "distance_m": 1648.8, "sun_percent": 88.5, "sun_seconds": 630.8,
                   "rain_percent": 0.0, "geometry": {"type": "LineString", "coordinates": [[-79.510152, 43.772013], "..."]}},
  "contextroute": {"seconds": 1225.7, "distance_m": 1716.0, "sun_percent": 70.6, "sun_seconds": 523.8,
                   "rain_percent": 0.0, "geometry": {"type": "LineString", "coordinates": ["..."]}},
  "extra_seconds": 48.0,
  "sun_percent_change": -17.9,
  "rain_percent_change": 0.0
}
```

`contextroute` is the Detour route. `origin`/`destination` are `[lat, lon]`; GeoJSON coordinates are `[lon, lat]`.
`sun_percent` and `rain_percent` are already percentages (0-100), and `cloud_cover` is a fraction (0-1).
`weather.source` is `"live"` (Open-Meteo), `"clear_sky"` (`clear_sky=true`) or `"unavailable"` (the fetch failed, so
a clear, dry sky is assumed); the weather values are `null` unless it is `"live"`.

`contextroute` is chosen from the trip's `route_options` routes (see *Choosing the route* below); the
options are cached per trip and time, so moving only the avoidance slider answers in milliseconds.

### `GET /shadows`

Query: `date`, `time`. Returns a GeoJSON FeatureCollection with one MultiPolygon of building and tree shadow
pieces (no features at night). The pieces overlap: computing their union takes seconds per time slice, so it is
skipped. Draw it as one semi-transparent layer under the routes with the **nonzero** fill rule (Leaflet
`fillRule: "nonzero"`), which fills overlaps once, so it looks exactly like the union. Responses are cached per
15-minute slice (up to 64 slices).

### `GET /campus`

GeoJSON Feature with the Keele campus boundary (OSM way 15396822). `/route` answers 422 for a pin outside it,
and the frontend draws it and refuses clicks outside it.

### `GET /health` (also `HEAD`)

`{"status": "ok", "edges": 5172, "buildings": 737}`. Render's health check and uptime monitors use it.

### Drawing it in react-leaflet

`<GeoJSON>` does not redraw when its `data` prop changes, so `CampusMap.tsx` keys each layer by the request path
(`route.path`), and a new response replaces the layer:

```tsx
<GeoJSON key={`fast-${route.path}`} data={r.fastest.geometry} style={{ color: "#e0161b", weight: 5, dashArray: "1 9" }} />
<GeoJSON key={`ctx-${route.path}`}  data={r.contextroute.geometry} style={{ color: "#138a3e", weight: 7 }} />
<GeoJSON key={`shadows-${shadows.path}`} data={shadows.value} style={{ weight: 0, fillOpacity: 0.32, fillRule: "nonzero" }} />
```

Each route also has a wider white casing drawn under it, and shadows sit in their own pane below the routes.
The frontend debounces the date/time/slider input by 150 ms and aborts superseded requests.

## Choosing the route

A single weight (`cost = time + w * sun`) moves the route in jumps: a weighted sum only ever finds the routes on
the convex hull of the time/sun trade-off, so the ones in between are never chosen, and most of the change happens
at small weights. Instead, `shade_options()` in `router.py` finds the whole Pareto set: every route that no other
route beats on both cost and sun, where cost is walking time plus `w_rain` × rain-seconds. It is a bicriteria A*
search (Martins' algorithm) where each node can hold several labels, each with its own arrival time. Two limits
keep the set useful: options cost at most 50 % more than the quickest, and each option must cut the sun by at least
2 % of the quickest route's sun, and by at least 1 sun-second (`MAX_DETOUR`, `SUN_STEP`).

`sun_avoidance = p` picks the quickest option whose sun is at most `fastest_sun - p * (fastest_sun - shadiest_sun)`.
The fastest route is always the pure-time A* route (`route()`), whatever `w_rain` is. The response's
`route_options` says how many options the trip has (9 for the demo trip above).

## Pipeline

```
date/time -> sun position (pvlib) -> building and tree shadows (ShadowCaster)
          -> shade fraction per walkway edge -> sun-seconds per edge (trapezoid integral)
date      -> Open-Meteo hourly direct radiation + precipitation -> sun intensity, rain intensity
             roofs (buildings, covered/indoor ways) -> shelter fraction per edge -> rain-seconds per edge
          -> per route: cost = seconds + w_rain * rain_seconds, and sun_seconds
          -> every cost/sun trade-off (Pareto set) -> sun_avoidance picks one
```

| File | Role |
|---|---|
| `sun.py` | sun elevation/azimuth (pvlib) |
| `shadow.py` | `L = h / tan(theta)`; building shadows by sweeping the footprint; tree canopy shadows |
| `data.py` | OSM campus polygon, walk graph and trees; Toronto 3D Massing buildings (cached in `backend/cache/`) |
| `weather.py` | Open-Meteo client: hourly direct radiation, cloud cover, precipitation for a date (cached 30 min) |
| `exposure.py` | per-edge shade and shelter fractions; sun- and rain-exposure integrals |
| `router.py` | A* fastest route; Pareto set of time/sun trade-offs and the avoidance pick |
| `trip.py` | the demo trip's start and end, and the nearest-graph-node lookup |
| `api.py` | FastAPI endpoints and caches |

## Assumptions (for the judges' explanation)

- Building heights come from the City of Toronto 3D Massing snapshot (`backend/data/`), using each footprint's
  maximum height.
- Flat ground and a constant walking speed of 1.4 m/s.
- Shadows are not computed when the sun is below 3 degrees, and shadow length is capped at 300 m.
- Shade fraction is measured at sample points 1.5 m apart along each edge, using the nearest 15-minute shadow.
  Checked against exact geometry over the whole campus at 9:00, 13:00 and 17:00: the length-weighted
  difference was under 0.5 percentage points.
- Sun intensity is Open-Meteo's forecast **direct** radiation / 1000 W/m². Shade only blocks the direct beam (diffuse
  skylight reaches you in the shade too), so under full overcast there is nothing to avoid. If the weather can't be
  fetched, or `clear_sky=true`, intensity falls back to a clear sky, `max(0, sin(elevation))`. Cloud cover is
  only reported to the UI; it does not change the route.
- Open-Meteo radiation and precipitation are averages over the hour ending at each timestamp, so they are placed at
  the middle of that hour and interpolated to the minute. Open-Meteo uses one UTC offset for the whole day, so on
  the two DST-change days the weather after 02:00 can be an hour out (the sun position is still exact).
- Weather is fetched for the campus centre only, cached for 30 minutes per date, and retried after 60 s if a
  fetch fails.
- Rain intensity is `min(1, mm/h / 4)`: moderate rain (4 mm/h) or heavier counts as 1.
- Shelter: an edge's share of 1.5 m sample points inside a building footprint, or 1 for walkways tagged
  `covered=yes/arcade/colonnade`, `indoor=yes/corridor`, `highway=corridor` or `tunnel=building_passage/yes`.
  Wind-blown rain is ignored.
- Edges through building footprints count as fully shaded and sheltered (indoor connections).
- Trees (OSM `natural=tree` points) have no size data, so each is a canopy disk of radius 3 m from 2 m to 9 m up
  (constants in `shadow.py`). Its shadow is the hull of the crown shifted by `2 m / tan(theta)` and `9 m / tan(theta)`,
  so the ground under a tree is only shaded when the sun is high. The trunk is ignored.
- The time-dependent search settles nodes by accumulated cost, which is exact only if arriving earlier never
  makes the rest of the walk costlier. Walks last minutes and the sun moves slowly, so the error is negligible.
- A* runs for every search: each edge costs at least its walking time, so `0.99 x straight line / 1.4 m/s` is a
  consistent heuristic and A* returns the same route as Dijkstra while settling fewer nodes.
