# ShadeRoute / ContextRoute — Project Summary

A heat-aware walking router for York University's Keele Campus. It finds routes that trade a little extra walking time for less sun exposure, using real building shadows at a chosen date and time.

## Architecture

```
Next.js + react-leaflet (:3000)  ──HTTP──►  FastAPI backend (:8000)
 map, pins, date/time/sliders               sun + shadow math, A* routing
 draws what the API returns                 CORS allowed for localhost:3000
```

The frontend does no routing or sun math. It sends date, time, weights and pin positions, and draws the GeoJSON that comes back.

## Frontend (`src/`)

- Stack: Next.js 16 (Turbopack), React 19, TypeScript, Leaflet / react-leaflet, Tailwind 4.
- `app/page.tsx`, `layout.tsx`, `globals.css`: page shell and map layout.
- `components/CampusMapLoader.tsx`: client-only loader so Leaflet doesn't run on the server.
- `components/CampusMap.tsx`: the main UI.
  - OSM tiles, zoom and scale controls, centred on Keele (`43.7735, -79.5019`, zoom 16).
  - Click-to-place start and end pins, which can also be dragged.
  - Controls for date, time of day, sun weight (`w_sun`) and cloud cover.
  - Layers: building shadows, fastest route (red), shade-aware "context" route (green), plus route stats.
  - Requests are debounced 150 ms and aborted when superseded.

## Backend (`backend/`)

Pipeline: date/time → sun position → building shadows → shade fraction per walkway edge → sun-seconds per edge → edge cost → A*.

| File | Role |
|---|---|
| `sun.py` | Sun elevation/azimuth (pvlib) |
| `shadow.py` | Building shadows on flat ground, `L = h / tan(θ)` |
| `data.py` | OSM campus polygon, walk graph, buildings, trees (cached in `backend/cache/`) |
| `exposure.py` | Per-edge shade fraction and sun-exposure integral |
| `router.py` | Time-dependent A*/Dijkstra, cost = `w_time·seconds + w_sun·sun_seconds` |
| `trip.py` | Default demo trip and nearest-node lookup |
| `api.py` | FastAPI app |
| `static/demo.html` | Standalone demo page |
| `demo_*.py` | Scripts that produce `campus_shadows.png`, `shadow_demo.png`, `route_demo.png` |
| `tests/` | `test_api.py`, `test_router.py`, `test_sun_shadow.py` |

### Endpoints

- `GET /route`: `date`, `time`, `w_sun` (0–50, 0 = fastest), `cloud_cover` (0–1), and optional `from_lat/from_lon/to_lat/to_lon`. Returns sun info, the fastest route and the shade-aware route (seconds, distance, sun %, GeoJSON), extra seconds and the change in sun %.
- `GET /shadows`: `date`, `time`. Returns a GeoJSON FeatureCollection of the combined shadow, empty at night.
- `GET /health`, `GET /demo` (standalone page), `GET /docs` (OpenAPI).

### Model assumptions

- Flat ground. Building height comes from OSM `height`, else `levels × 3 m`, else a per-type default.
- No shadows below 3° sun elevation. Shadow length is capped at 300 m.
- Shade is sampled every 1.5 m along each edge, using the nearest 15-minute shadow.
- Walking speed is 1.4 m/s. Sun intensity is `sin(elevation)` times a cloud transmission factor.
- Edges through buildings count as fully shaded (indoor connections).
- Trees, elevation and rain are not modelled yet.
- Time-dependent search is approximate, with negligible error for walks lasting minutes.

## Running it

```bash
# backend (repo root)
pip install -r requirements.txt
python -m uvicorn backend.api:app --port 8000     # /docs, /demo
python -m pytest backend

# frontend
npm install
npm run dev                                      # http://localhost:3000
npm run lint ; npm run build
```

Set `NEXT_PUBLIC_API_URL` to point the frontend at a different backend.

## Git history (newest first)

1. Add backend demo run instructions to README
2. Port backend demo into Next.js app: route, shadow and control panel
3. Add FastAPI `/route` and `/shadows` endpoints with date/time control
4. Add shadow and route demo scripts
5. Add sun-exposure model and time-dependent A*/Dijkstra router

Uncommitted: `backend/api.py`, `backend/tests/test_api.py`, `src/app/globals.css` and `src/components/CampusMap.tsx` (custom start/end pins, plus the stale-route fix from this session).

## This session

- Freed ports 8000 and 3000 by killing stale python and node processes, then restarted both servers.
- Favicon: no error reproduced. `/favicon.ico` is 200 on :3000 and a harmless 404 on :8000.
- Fixed the pin-drag glitch where the old route showed until the new one loaded. Not yet verified in a browser.
- Wrote `SESSION_NOTES.md` (session log) and this file.
