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
  fmtDuration,
  getJson,
  KEELE_CAMPUS_CENTER,
  type LatLon,
  MIN_ZOOM,
  minutesToTime,
  parseRoute,
  parseShadows,
  routeQuery,
  type RouteResponse,
  type RouteStats,
  type Scenario,
  scenarioKey,
  type ShadowCollection,
  shadowKey,
  shadowQuery,
  signed,
} from "@/lib/route";

type PinKind = "start" | "end";

const pinIcon = (kind: PinKind) =>
  L.divIcon({
    className: "",
    html: `<div class="pin pin-${kind}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
const PIN_ICONS = { start: pinIcon("start"), end: pinIcon("end") };

const SHADOW_COLOR = "#e8590c";

function ClickToPlace({ onPick }: { onPick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

// Each layer remembers the scenario it was fetched for, and is dimmed while
// the current scenario differs.
type Data = { key: string; route: RouteResponse };
type Shadows = { key: string; collection: ShadowCollection };

function describe(r: RouteStats) {
  return `${fmtDuration(r.seconds)} · ${Math.round(r.distance_m)} m · ${Math.round(r.sun_percent)}% sun`;
}

export default function CampusMap() {
  const [date, setDate] = useState("2026-06-21");
  const [minutes, setMinutes] = useState(14 * 60);
  const [avoidance, setAvoidance] = useState(DEFAULT_AVOIDANCE);
  const [cloud, setCloud] = useState(0);
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
                fillOpacity: shadowsStale ? 0.15 : 0.4,
                weight: 0,
              }}
            />
          )}
        </Pane>
        {/* Keyed by the scenario the data belongs to: react-leaflet's GeoJSON
            ignores later changes to its data prop. Stale routes are dimmed. */}
        {data && (
          <>
            <GeoJSON
              key={`fast-${data.key}`}
              data={data.route.fastest.geometry}
              interactive={false}
              style={{
                color: "#d1342f",
                weight: 7,
                opacity: routeStale ? 0.3 : 0.85,
                dashArray: routeStale ? "6 8" : undefined,
              }}
            />
            <GeoJSON
              key={`ctx-${data.key}`}
              data={data.route.contextroute.geometry}
              interactive={false}
              style={{
                color: "#1f8f3a",
                weight: 4,
                opacity: routeStale ? 0.3 : 0.95,
                dashArray: routeStale ? "6 8" : undefined,
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
        <ZoomControl position="topright" />
        <ScaleControl position="bottomleft" />
      </MapContainer>

      <aside className="route-panel" aria-label="Route controls">
        <p className="route-hint">
          Click the map to place the {placing} pin, or drag a pin to move it.
        </p>
        <div className="pin-controls">
          {(["start", "end"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              aria-pressed={placing === kind}
              onClick={() => setPlacing(kind)}
            >
              Set {kind}
            </button>
          ))}
          <button type="button" onClick={reset} disabled={!start && !end}>
            Reset
          </button>
        </div>
        <label>
          Date
          <input
            type="date"
            value={date}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </label>
        <label>
          Time of day: {minutesToTime(minutes)}
          <input
            type="range"
            min={0}
            max={1439}
            step={5}
            value={minutes}
            aria-valuetext={minutesToTime(minutes)}
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        <label>
          Sun avoidance: {avoidance}%
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={avoidance}
            aria-valuetext={`${avoidance}%`}
            onChange={(e) => setAvoidance(Number(e.target.value))}
          />
        </label>
        <label>
          Cloud cover: {Math.round(cloud * 100)}%
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cloud}
            aria-valuetext={`${Math.round(cloud * 100)}%`}
            onChange={(e) => setCloud(Number(e.target.value))}
          />
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={showShadows}
            onChange={(e) => setShowShadows(e.target.checked)}
          />
          Show shadows (buildings and trees)
        </label>
        <ul className="route-legend">
          <li><span className="swatch swatch-fast" />Fastest</li>
          <li><span className="swatch swatch-ctx" />ContextRoute</li>
          {showShadows && <li><span className="swatch swatch-shadow" />Shadow</li>}
        </ul>
        {r && (
          <div className={routeStale ? "route-stats stale" : "route-stats"} aria-busy={routeStale}>
            <p className="route-sun">
              {r.sun.is_daylight
                ? `Sun elevation ${r.sun.elevation_deg.toFixed(0)}° · azimuth ${r.sun.azimuth_deg.toFixed(0)}°`
                : "Sun is below the horizon, so there are no shadows and no sun exposure."}
            </p>
            <div className="route-card route-card-fast">
              <h2>Fastest route</h2>
              <p>{describe(r.fastest)}</p>
            </div>
            <div className="route-card route-card-ctx">
              <h2>ContextRoute</h2>
              <p>{describe(r.contextroute)}</p>
            </div>
            <p className="route-delta">
              {signed(r.extra_seconds)} sec, {signed(r.sun_percent_change)} pts sun
              exposure
            </p>
          </div>
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
      </aside>
    </>
  );
}
