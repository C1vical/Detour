"use client";

import L from "leaflet";
import { useEffect, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  Pane,
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
  MIN_ZOOM,
  minutesToTime,
  parseRoute,
  parseShadows,
  routeQuery,
  type RouteResponse,
  type Scenario,
  scenarioKey,
  type ShadowCollection,
  shadowKey,
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

// Shade is a cool slate so it never competes with the route colours.
const SHADOW_COLOR = "#2f3b4c";
const DETOUR_COLOR = "#138a3e";
const FAST_COLOR = "#e0161b";

function ClickToPlace({ onPick }: { onPick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

// Each layer remembers the scenario it was fetched for, and is dimmed while
// the current scenario differs.
type Data = { key: string; route: RouteResponse };
type Shadows = { key: string; collection: ShadowCollection };

export default function CampusMap() {
  const [date, setDate] = useState("2026-06-21");
  const [minutes, setMinutes] = useState(14 * 60);
  const [avoidance, setAvoidance] = useState(DEFAULT_AVOIDANCE);
  // Cloud cover is no longer user-facing; it stays at its default and is
  // still sent with every route request.
  const [cloud] = useState(0);
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [placing, setPlacing] = useState<PinKind>("start");
  const [showShadows, setShowShadows] = useState(false);
  const [data, setData] = useState<Data | null>(null);
  const [shadows, setShadows] = useState<Shadows | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  const [shadowError, setShadowError] = useState<{ key: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  const scenario: Scenario = { date, minutes, avoidance, cloud, start, end };
  const key = scenarioKey(scenario);
  const sKey = shadowKey(scenario);

  useEffect(() => {
    const s: Scenario = { date, minutes, avoidance, cloud, start, end };
    const k = scenarioKey(s);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const route = parseRoute(await getJson(`/route?${routeQuery(s)}`, controller.signal));
        if (controller.signal.aborted) return;
        setData({ key: k, route });
        setError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setError({ key: k, message: e instanceof Error ? e.message : String(e) });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [date, minutes, avoidance, cloud, start, end, attempt]);

  // Shadows depend only on date and time, and are only fetched while shown.
  useEffect(() => {
    if (!showShadows) return;
    const s = { date, minutes };
    const sk = shadowKey(s);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const collection = parseShadows(
          await getJson(`/shadows?${shadowQuery(s)}`, controller.signal),
        );
        if (controller.signal.aborted) return;
        setShadows({ key: sk, collection });
        setShadowError(null);
      } catch (e) {
        if (controller.signal.aborted) return;
        setShadowError({ key: sk, message: e instanceof Error ? e.message : String(e) });
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [showShadows, date, minutes, attempt]);

  const r = data?.route;
  const routeStale = data?.key !== key;
  const shadowsStale = shadows?.key !== sKey;
  const failed =
    error?.key === key
      ? error.message
      : showShadows && shadowError?.key === sKey
        ? `shadows: ${shadowError.message}`
        : null;
  const startPos = start ?? r?.origin;
  const endPos = end ?? r?.destination;

  const place = (kind: PinKind, p: LatLon) => {
    if (kind === "start") setStart(p);
    else setEnd(p);
  };
  const pick = (p: LatLon) => {
    place(placing, p);
    setPlacing(placing === "start" ? "end" : "start");
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
          {showShadows && shadows && (
            <GeoJSON
              key={`shadows-${shadows.key}`}
              data={shadows.collection}
              interactive={false}
              style={{
                color: SHADOW_COLOR,
                fillColor: SHADOW_COLOR,
                fillOpacity: shadowsStale ? 0.12 : 0.32,
                weight: 0,
              }}
            />
          )}
        </Pane>
        {/* Keyed by the scenario the data belongs to: react-leaflet's GeoJSON
            ignores later changes to its data prop. Stale routes are dimmed. */}
        {data && (
          <>
            {/* Fastest is a dotted reference line; Detour is the hero, drawn
                last. Both sit on a white casing so they read over the map. */}
            <GeoJSON
              key={`fast-casing-${data.key}`}
              data={data.route.fastest.geometry}
              interactive={false}
              style={{
                color: "#ffffff",
                weight: 8.5,
                opacity: routeStale ? 0.25 : 0.85,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <GeoJSON
              key={`fast-${data.key}`}
              data={data.route.fastest.geometry}
              interactive={false}
              style={{
                color: FAST_COLOR,
                weight: 5,
                opacity: routeStale ? 0.35 : 1,
                dashArray: "1 9",
                lineCap: "round",
              }}
            />
            <GeoJSON
              key={`ctx-casing-${data.key}`}
              data={data.route.contextroute.geometry}
              interactive={false}
              style={{
                color: "#ffffff",
                weight: 11,
                opacity: routeStale ? 0.3 : 0.95,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
            <GeoJSON
              key={`ctx-${data.key}`}
              data={data.route.contextroute.geometry}
              interactive={false}
              style={{
                color: DETOUR_COLOR,
                weight: 7,
                opacity: routeStale ? 0.35 : 1,
                dashArray: routeStale ? "6 8" : undefined,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </>
        )}
        <ClickToPlace onPick={pick} />
        {(["start", "end"] as const).map((kind) => {
          const pos = kind === "start" ? startPos : endPos;
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
            {r && (
              <p className={routeStale ? "climate-line stale" : "climate-line"}>
                <span className="climate-sun" aria-hidden="true" />
                {r.sun.is_daylight ? `Sun ${r.sun.elevation_deg.toFixed(0)}°` : "Sun down"}
                {" · "}
                {minutesToTime(minutes)}
              </p>
            )}
          </div>
          {r ? (
            <div className={routeStale ? "route-stats stale" : "route-stats"} aria-busy={routeStale}>
              <RoutePair
                detour={r.contextroute}
                fastest={r.fastest}
                extraSeconds={r.extra_seconds}
              />
            </div>
          ) : (
            !failed && <div className="route-skeleton" aria-hidden="true" />
          )}
          <div role="status" className="route-status">
            {failed ? (
              <>
                Couldn&apos;t update the route: {failed}.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setShadowError(null);
                    setAttempt((n) => n + 1);
                  }}
                >
                  Retry
                </button>
              </>
            ) : (
              routeStale && (r ? "Updating..." : "Loading...")
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
              const custom = kind === "start" ? start : end;
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
                      {placing === kind ? "Click map" : custom ? "Custom" : "Default"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className="route-hint">Click the map to place the {placing} pin, or drag a pin to move it.</p>
        </section>

        <section className="panel-section" aria-labelledby="env-heading">
          <h2 id="env-heading"><span>03</span>Environment</h2>
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
              step={5}
              value={minutes}
              display={minutesToTime(minutes)}
              onChange={setMinutes}
            />
            <Slider
              label="Sun avoidance"
              min={0}
              max={100}
              step={5}
              value={avoidance}
              display={`${avoidance}%`}
              onChange={setAvoidance}
            />
          </div>
          <Switch checked={showShadows} onChange={setShowShadows}>
            Show shadows
            <small>Buildings and trees</small>
          </Switch>
        </section>
      </aside>
    </>
  );
}
