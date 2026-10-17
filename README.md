# ShadeRoute

ShadeRoute is a heat-aware walking navigation app for York University's Keele
Campus. The initial map display is built with Next.js, React, TypeScript, and
Leaflet.

## Map display structure

```text
src/
├── app/
│   ├── globals.css       # Leaflet CSS and responsive map layout
│   ├── layout.tsx        # App metadata and global styles
│   └── page.tsx          # ShadeRoute map page shell
└── components/
    ├── CampusMap.tsx     # Leaflet map, OSM tiles, zoom and scale controls
    └── CampusMapLoader.tsx # Client-only loading boundary for Leaflet
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

The production checks are:

```bash
npm run lint
npm run build
```
