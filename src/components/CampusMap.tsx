"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
  Polyline,
  ScaleControl,
  TileLayer,
  Tooltip,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";

import {
  CAMPUS_BOUNDS,
  DEFAULT_AVOIDANCE,
  getJson,
  KEELE_CAMPUS_CENTER,
  type LatLon,
  type Weather,
  MIN_ZOOM,
  minutesToTime,
  nowInToronto,
  parseRoute,
  parseShadows,
  routeQuery,
  shadowQuery,
} from "@/lib/route";

import { RoutePair, Slider, Switch } from "./PanelControls";

type PinKind = "start" | "end";

const pinIcon = (kind: PinKind) =>
  L.divIcon({
    className: "",
    html: `<div class="pin pin-${kind}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
const PIN_ICONS = { start: pinIcon("start"), end: pinIcon("end") };

// Route ends as [lat, lon], or null if the geometry isn't a LineString.
function lineEnds(g: unknown): { first: LatLon; last: LatLon } | null {
  const c = (g as { coordinates?: unknown })?.coordinates;
  if (!Array.isArray(c) || c.length === 0) return null;
  const a = c[0] as number[];
  const b = c[c.length - 1] as number[];
  return { first: [a[1], a[0]], last: [b[1], b[0]] };
}

// Shade is a cool slate so it never competes with the route colours.
const SHADOW_COLOR = "#2f3b4c";
const DETOUR_COLOR = "#138a3e";
const FAST_COLOR = "#e0161b";

const isRaining = (w: Weather) => (w.rain_mm_h ?? 0) > 0;

// One line for the panel, so the weather the route was computed with is visible.
function describeWeather(w: Weather) {
  if (w.source === "clear_sky") return "Clear sky (simulated).";
  if (w.source === "unavailable") return "Weather unavailable, assuming clear sky.";
  const cloud = Math.round((w.cloud_cover ?? 0) * 100);
  return `Cloud ${cloud}% · direct sun ${w.direct_wm2} W/m² · rain ${w.rain_mm_h} mm/h (live, Open-Meteo)`;
}

function ClickToPlace({ onPick }: { onPick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

// A debounced GET. The result remembers the path it was fetched for, so the
// map can dim it while the current path differs (`stale`). A null path skips
// the request.
function useRemote<T>(path: string | null, parse: (v: unknown) => T) {
  const [loaded, setLoaded] = useState<{ path: string; value: T } | null>(null);
  const [error, setError] = useState<{ path: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const value = parse(await getJson(path, controller.signal));
        if (controller.signal.aborted) return;
        setLoaded({ path, value });
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError({ path, message: e instanceof Error ? e.message : String(e) });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [path, parse, attempt]);

  return {
    value: loaded?.value,
    path: loaded?.path,
    stale: loaded?.path !== path,
    error: error?.path === path ? error.message : null,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

export default function CampusMap() {
  // Date and time default to the present; any change below refetches routes and shadows.
  const [initialNow] = useState(() => nowInToronto());
  const [date, setDate] = useState(initialNow.date);
  const [minutes, setMinutes] = useState(initialNow.minutes);
  const [sunAvoidance, setSunAvoidance] = useState(DEFAULT_AVOIDANCE);
  const [avoidRain, setAvoidRain] = useState(false);
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [placing, setPlacing] = useState<PinKind>("start");
  const [showShadows, setShowShadows] = useState(false);

  // No route until both pins are placed.
  const route = useRemote(
    start && end ? `/route?${routeQuery({ date, minutes, sunAvoidance, avoidRain, start, end })}` : null,
    parseRoute,
  );
  // Shadows depend only on date and time, and are only fetched while shown.
  const shadows = useRemote(
    showShadows ? `/shadows?${shadowQuery({ date, minutes })}` : null,
    parseShadows,
  );

  const r = start && end ? route.value : undefined;
  const failed = route.error ?? (shadows.error && `shadows: ${shadows.error}`);

  const place = (kind: PinKind, p: LatLon) => {
    if (kind === "start") setStart(p);
    else setEnd(p);
  };
  const pick = (p: LatLon) => {
    place(placing, p);
    setPlacing(placing === "start" ? "end" : "start");
  };
  const resetToNow = () => {
    const now = nowInToronto();
    setDate(now.date);
    setMinutes(now.minutes);
  };
  const reset = () => {
    setStart(null);
    setEnd(null);
    setPlacing("start");
  };

  return (
    <>
      <MapContainer
        center={KEELE_CAMPUS_CENTER}
        className="campus-map"
        maxBounds={CAMPUS_BOUNDS}
        maxBoundsViscosity={1}
        minZoom={MIN_ZOOM}
        scrollWheelZoom
        zoom={16}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {/* Below the overlay pane, so shadows never cover the routes. */}
        <Pane name="shadows" style={{ zIndex: 350 }}>
          {showShadows && shadows.value && (
            <GeoJSON
              key={`shadows-${shadows.path}`}
              data={shadows.value}
              interactive={false}
              style={{
                color: SHADOW_COLOR,
                fillColor: SHADOW_COLOR,
                fillOpacity: shadows.stale ? 0.12 : 0.32,
                weight: 0,
              }}
            />
          )}
        </Pane>
        {/* Keyed by the request path: react-leaflet's GeoJSON
            ignores later changes to its data prop. Stale routes are dimmed. */}
        {r && (
          <>
            {/* Fastest is a dotted reference line; Detour is the hero, drawn
                last. Both sit on a white casing so they read over the map. */}
            <GeoJSON
              key={`fast-casing-${route.path}`}
              data={r.fastest.geometry}
              interactive={false}
              style={{
                color: "#ffffff",
                weight: 8.5,
                opacity: route.stale ? 0.25 : 0.85,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <GeoJSON
              key={`fast-${route.path}`}
              data={r.fastest.geometry}
              interactive={false}
              style={{
                color: FAST_COLOR,
                weight: 5,
                opacity: route.stale ? 0.35 : 1,
                dashArray: "1 9",
                lineCap: "round",
              }}
            />
            <GeoJSON
              key={`ctx-casing-${route.path}`}
              data={r.contextroute.geometry}
              interactive={false}
              style={{
                color: "#ffffff",
                weight: 11,
                opacity: route.stale ? 0.3 : 0.95,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <GeoJSON
              key={`ctx-${route.path}`}
              data={r.contextroute.geometry}
              interactive={false}
              style={{
                color: DETOUR_COLOR,
                weight: 7,
                opacity: route.stale ? 0.35 : 1,
                dashArray: route.stale ? "6 8" : undefined,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </>
        )}
        {/* Routes follow the walkway graph, so they can stop short of a pin
            placed off the path; dotted links close the gap on both routes. */}
        {r &&
          start &&
          end &&
          [
            { stats: r.fastest, color: FAST_COLOR },
            { stats: r.contextroute, color: DETOUR_COLOR },
          ].flatMap(({ stats, color }) => {
            const ends = lineEnds(stats.geometry);
            if (!ends) return [];
            return [
              [start, ends.first],
              [end, ends.last],
            ].map((positions, i) => (
              <Polyline
                key={`link-${color}-${i}-${route.path}-${start}-${end}`}
                positions={positions as LatLon[]}
                interactive={false}
                pathOptions={{
                  color,
                  weight: 3,
                  opacity: route.stale ? 0.35 : 1,
                  dashArray: "1 8",
                  lineCap: "round",
                }}
              />
            ));
          })}
        <ClickToPlace onPick={pick} />
        {(["start", "end"] as const).map((kind) => {
          const pos = kind === "start" ? start : end;
          return (
            pos && (
              <Marker
                key={kind}
                position={pos}
                icon={PIN_ICONS[kind]}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const ll = e.target.getLatLng();
                    place(kind, [ll.lat, ll.lng]);
                  },
                }}
              >
                <Tooltip>{kind === "start" ? "Start" : "End"}</Tooltip>
              </Marker>
            )
          );
        })}
        <ZoomControl position="topleft" />
        <ScaleControl position="bottomleft" />
      </MapContainer>

      <ul className="map-legend" aria-label="Map legend">
        <li><span className="line-key line-key-ctx" />Detour</li>
        <li><span className="line-key line-key-fast" />Fastest</li>
        {showShadows && <li><span className="swatch-shadow" />Shadow</li>}
      </ul>

      <aside className="route-panel" aria-label="Route controls">
        <section className="panel-section" aria-labelledby="results-heading">
          <div className="section-head">
            <h2 id="results-heading"><span>01</span>Route</h2>
            {/* Always shown; the sun angle comes with a route, so it waits for both pins. */}
            <p className={r && route.stale ? "climate-line stale" : "climate-line"}>
              <span className="climate-sun" aria-hidden="true" />
              {r && (r.sun.is_daylight ? `Sun ${r.sun.elevation_deg.toFixed(0)}° · ` : "Sun down · ")}
              {minutesToTime(minutes)}
            </p>
          </div>
          {r ? (
            <div className={route.stale ? "route-stats stale" : "route-stats"} aria-busy={route.stale}>
              <RoutePair
                detour={r.contextroute}
                fastest={r.fastest}
                extraSeconds={r.extra_seconds}
                showRain={isRaining(r.weather)}
              />
              <p className="route-hint">{describeWeather(r.weather)}</p>
            </div>
          ) : start && end ? (
            !failed && <div className="route-skeleton" aria-hidden="true" />
          ) : (
            <p className="route-hint">Place a start and an end pin to see your route.</p>
          )}
          <div role="status" className="route-status">
            {failed ? (
              <>
                Couldn&apos;t update the route: {failed}.{" "}
                <button
                  type="button"
                  onClick={() => {
                    route.retry();
                    shadows.retry();
                  }}
                >
                  Retry
                </button>
              </>
            ) : (
              start && end && route.stale && (r ? "Updating..." : "Loading...")
            )}
          </div>
        </section>

        <section className="panel-section" aria-labelledby="pins-heading">
          <div className="section-head">
            <h2 id="pins-heading"><span>02</span>Trip</h2>
            <button
              type="button"
              className="text-button"
              onClick={reset}
              disabled={!start && !end}
            >
              Reset
            </button>
          </div>
          <div className="pin-controls">
            {(["start", "end"] as const).map((kind) => {
              const placed = kind === "start" ? start : end;
              return (
                <button
                  key={kind}
                  type="button"
                  className="pin-button"
                  aria-pressed={placing === kind}
                  onClick={() => setPlacing(kind)}
                >
                  <span className={`pin-dot pin-dot-${kind}`} aria-hidden="true" />
                  <span className="pin-button-text">
                    <span className="pin-button-label">Set {kind}</span>
                    <span className="pin-button-sub">
                      {placing === kind ? "Click map" : placed ? "Placed" : "Not set"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="route-hint">Click the map to place the {placing} pin, or drag a pin to move it.</p>
        </section>

        <section className="panel-section" aria-labelledby="env-heading">
          <div className="section-head">
            <h2 id="env-heading"><span>03</span>Environment</h2>
            <button type="button" className="text-button" onClick={resetToNow}>
              Now
            </button>
          </div>
          <div className="env-grid">
            <label className="field">
              <span className="field-row">
                <span className="field-label">Date</span>
              </span>
              <input
                type="date"
                className="date-input"
                value={date}
                onChange={(e) => e.target.value && setDate(e.target.value)}
              />
            </label>
            <Slider
              label="Time"
              min={0}
              max={1439}
              step={1}
              value={minutes}
              display={minutesToTime(minutes)}
              onChange={setMinutes}
            />
            <Slider
              label="Sun avoidance"
              min={0}
              max={100}
              step={5}
              value={sunAvoidance}
              display={`${sunAvoidance}%`}
              onChange={setSunAvoidance}
            />
          </div>
          <Switch checked={avoidRain} onChange={setAvoidRain}>
            Avoid rain
            <small>
              {r && !isRaining(r.weather) ? "No rain at this time" : "Stay under roofs while it rains"}
            </small>
          </Switch>
          <Switch checked={showShadows} onChange={setShowShadows}>
            Show shadows
            <small>Buildings and trees</small>
          </Switch>
        </section>
      </aside>
    </>
  );
}
