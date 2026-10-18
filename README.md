# Detour

Detour is a heat-aware walking navigation app for York University's Keele
Campus. The frontend is built with Next.js, React, TypeScript, and Leaflet; the
routing and sun/shadow math live in a Python backend.

## Frontend structure

```text
src/
├── app/
│   ├── globals.css         # Leaflet overrides, panel and map layout
│   ├── layout.tsx          # App metadata, fonts and global styles
│   └── page.tsx            # Page shell: header and map
├── components/
│   ├── CampusMap.tsx       # Leaflet map, route/shadow layers, pins, control panel
│   ├── CampusMapLoader.tsx # Client-only loading boundary for Leaflet
│   └── PanelControls.tsx   # Slider, switch and route-summary pieces of the panel
└── lib/
    └── route.ts            # API types, request building, response validation
```

`CampusMap` starts at York University's Keele Campus (`43.7735, -79.5019`)
with a campus-level zoom of `16`. Users can pan and zoom with the standard
Leaflet controls and scroll wheel. OpenStreetMap attribution is rendered by
the tile layer.

## Getting started

**Requirements:** [Node.js](https://nodejs.org/) 20.9 or newer and
[Python](https://www.python.org/downloads/) 3.12 or newer (developed on 3.14).

```bash
git clone https://github.com/C1vical/Detour.git
cd Detour
npm run setup   # once: npm packages, a .venv virtualenv and the Python packages (a few minutes)
npm run dev     # starts the backend (:8000) and the frontend (:3000) together
```

Open <http://localhost:3000>. The backend takes a few seconds to load the
campus on first start; if the panel says it can't reach the backend, press
**Retry**. `Ctrl+C` stops both servers. You don't need to activate the
virtualenv: the scripts use `.venv` directly.

The backend's interactive API docs are at <http://localhost:8000/docs>.

The backend uses the packaged City of Toronto 2025 3D Massing footprints and
`MAX_HEIGHT` values for building shadows. OSM remains the source for the
pedestrian network, campus boundary, and tree locations. See
`backend/data/README.md` for dataset provenance.

### Checks

```bash
npm run lint    # ESLint
npm run build   # production build, including the TypeScript check
```

### Running the two servers separately

`npm run dev` is the same as running these in two terminals:

```bash
.venv/Scripts/python -m uvicorn backend.api:app --reload --port 8000   # macOS/Linux: .venv/bin/python
npm run dev:web
```

The frontend calls the backend at `http://localhost:8000`; set
`NEXT_PUBLIC_API_URL` to point it elsewhere.

### Troubleshooting

- **Port 3000 or 8000 already in use:** another copy is still running. Stop it
  (or close the terminal it runs in) and run `npm run dev` again.
- **"No Python environment yet":** run `npm run setup` first.
- **`pip install` fails on geopandas/osmnx:** make sure you're on a recent
  Python, delete `.venv` and run `npm run setup` again.

## Deploying

The backend runs on [Render](https://render.com) (it must stay running: the site asks it for every route
and shadow), and the frontend on [Vercel](https://vercel.com). Both redeploy on every push to `main`.

1. **Backend on Render.** Dashboard → **New** → **Blueprint** → pick this repo. Render reads
   `render.yaml` (Python version from `.python-version`). Leave `ALLOWED_ORIGINS` empty for now and deploy.
   The first build takes a few minutes. Check `https://<your-service>.onrender.com/health` says `"ok"`.
2. **Frontend on Vercel.** **Add New** → **Project** → import this repo (Next.js is detected). Under
   **Environment Variables** set `NEXT_PUBLIC_API_URL` to the Render address from step 1, then deploy.
3. **Let the site call the backend.** In Render → the service → **Environment**, set `ALLOWED_ORIGINS` to the
   Vercel address (e.g. `https://detour.vercel.app`; separate several with commas) and save. Render restarts it.

Notes:

- `NEXT_PUBLIC_API_URL` is built into the frontend, so after changing it, redeploy on Vercel.
- `render.yaml` uses the **free** plan, which sleeps after 15 minutes without visitors; the next visit then waits
  about a minute while it wakes. For an always-on backend, change `plan: free` to `plan: 0.5c-512mb`
  (512 MB is enough; the backend uses about 280 MB once loaded and stays under about 380 MB with its caches full).
- To also allow Vercel preview deployments, set `ALLOWED_ORIGIN_REGEX` on Render, e.g. `https://detour-.*\.vercel\.app`.

## Using the map

- Click the map to place the start and end pins, or drag them; the route appears once both are placed, and **Reset** removes the pins. The campus is outlined in orange and everything outside it is greyed out;
  pins can only be placed inside the outline (a pin dragged outside goes back).
- The date and time start at the current Toronto time; **Now** jumps back to it. Changing either refetches the route (and the shadows, when shown). Dates from 1900 to 2100 are supported.
- Sun avoidance is 0-100 % (starts at 50 %). The backend finds every route that trades walking time for shade on
  the trip (costing at most 50 % more than the fastest, where cost is walking time plus, with **Avoid rain** on,
  10 s per rain-second), and the slider picks the quickest one that avoids that share of
  the avoidable sun: 0 % is the fastest route, 100 % the shadiest. The panel says how many routes the trip offers;
  a trip with only two can only switch once.
- **Avoid rain** (off by default) keeps the route under shelter (buildings, covered walkways) while it rains.
  Sun strength and rain come from live Open-Meteo weather for the chosen date and time, shown under the route.
- **Show shadows** draws the building and tree shadows for the chosen date and time. It is off by default and
  shadows are only fetched while it is on. Routes always account for shade, whether or not the overlay is shown.

