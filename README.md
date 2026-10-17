# Detour (ShadeRoute)

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
    ├── route.ts            # API types, request building, response validation
    └── route.test.ts       # Unit tests for route.ts (npm test)
```

`CampusMap` starts at York University's Keele Campus (`43.7735, -79.5019`)
with a campus-level zoom of `16`. Users can pan and zoom with the standard
Leaflet controls and scroll wheel. OpenStreetMap attribution is rendered by
the tile layer.

## Getting started

Install dependencies and start the development server:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to view the map.

The backend uses the packaged City of Toronto 2025 3D Massing footprints and
`MAX_HEIGHT` values for building shadows. OSM remains the source for the
pedestrian network, campus boundary, and tree locations. See
`backend/data/README.md` for dataset provenance.

The production checks are:

```bash
npm run lint
npm test        # unit tests for src/lib (Node's built-in runner)
npm run build
```

## Running the backend demo (localhost:8000)

The Python backend does the sun/shadow math and routing. It also serves a
standalone demo page, so you don't need Node to try it.

**Requirements:** Python 3.10 or newer (developed on 3.14) and `git`.

1. Clone and enter the repo:

   ```bash
   git clone https://github.com/rish-mishra/mathhacks.git
   cd mathhacks
   ```

2. Create and activate a virtual environment (recommended):

   ```bash
   python -m venv .venv
   # Windows (PowerShell):  .venv\Scripts\Activate.ps1
   # Windows (Git Bash):    source .venv/Scripts/activate
   # macOS / Linux:         source .venv/bin/activate
   ```

3. Install the dependencies (this can take a few minutes):

   ```bash
   pip install -r requirements.txt
   ```

4. Start the server from the repo root:

   ```bash
   python -m uvicorn backend.api:app --port 8000
   ```

   The first start takes a few seconds while the campus graph loads.

5. Open it:

   - Demo page: <http://localhost:8000/demo>
   - API docs: <http://localhost:8000/docs>

Stop the server with `Ctrl+C`. Run the tests with `python -m pytest backend`.

### Troubleshooting

- **Port already in use:** another process is on 8000. Stop it, or use
  `--port 8001` and open that port instead.
- **`No module named backend`:** run the command from the repo root, not from
  inside `backend/`.
- **`pip install` fails on geopandas/osmnx:** make sure you're on a recent
  Python and upgrade pip first (`python -m pip install --upgrade pip`).

### Running the Next.js app on top of it (localhost:3000)

With the backend running, start the frontend in a second terminal:

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The app calls the backend at
`http://localhost:8000`; set `NEXT_PUBLIC_API_URL` to point it elsewhere.

## Using the map

- Click the map to place the start and end pins, or drag them; the route appears once both are placed, and **Reset** removes the pins. The map is limited to the campus area.
- The date and time start at the current Toronto time; **Now** jumps back to it. Changing either refetches the route and shadows.
- Sun avoidance is 0-100 %: 0 % is the fastest route, higher values trade walking time for shade.
- **Show shadows** draws the building and tree shadows for the chosen date and time. It is off by default and
  shadows are only fetched while it is on. Routes always account for shade, whether or not the overlay is shown.

