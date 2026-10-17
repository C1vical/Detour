"use client";

import type { GeoJsonObject } from "geojson";
import L from "leaflet";
import { useEffect, useState } from "react";
import {
  GeoJSON,
  MapContainer,
  Marker,
  ScaleControl,
  TileLayer,
  Tooltip,
  useMapEvents,
  ZoomControl,
} from "react-leaflet";

const KEELE_CAMPUS_CENTER: [number, number] = [43.7735, -79.5019];
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

type RouteStats = {
  seconds: number;
  distance_m: number;
  sun_percent: number;
  geometry: GeoJsonObject;
};

type RouteResponse = {
  origin: [number, number];
  destination: [number, number];
  sun: { elevation_deg: number; azimuth_deg: number; is_daylight: boolean };
  fastest: RouteStats;
  contextroute: RouteStats;
  extra_seconds: number;
  sun_percent_change: number;
};

type LatLon = [number, number];
type PinKind = "start" | "end";

const pinIcon = (kind: PinKind) =>
  L.divIcon({
    className: "",
    html: `<div class="pin pin-${kind}"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
const PIN_ICONS = { start: pinIcon("start"), end: pinIcon("end") };

function ClickToPlace({ onPick }: { onPick: (p: LatLon) => void }) {
  useMapEvents({ click: (e) => onPick([e.latlng.lat, e.latlng.lng]) });
  return null;
}

type Data = { key: string; route: RouteResponse; shadows: GeoJsonObject };

const pad = (n: number) => String(n).padStart(2, "0");
const minutesToTime = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const fmtDuration = (s: number) =>
  `${Math.floor(s / 60)} min ${pad(Math.round(s % 60))} sec`;
const signed = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(0)}`;

function describe(r: RouteStats) {
  return `${fmtDuration(r.seconds)} · ${Math.round(r.distance_m)} m · ${r.sun_percent.toFixed(0)}% sun`;
}

export default function CampusMap() {
  const [date, setDate] = useState("2026-06-21");
  const [minutes, setMinutes] = useState(14 * 60);
  const [wSun, setWSun] = useState(3);
  const [cloud, setCloud] = useState(0);
  const [start, setStart] = useState<LatLon | null>(null);
  const [end, setEnd] = useState<LatLon | null>(null);
  const [placing, setPlacing] = useState<PinKind>("start");
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState("Loading...");

  const routeKey = `${date}-${minutes}-${wSun}-${cloud}-${start}-${end}`;

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      const time = minutesToTime(minutes);
      const route = new URLSearchParams({
        date,
        time,
        w_sun: String(wSun),
        cloud_cover: String(cloud),
      });
      if (start) {
        route.set("from_lat", String(start[0]));
        route.set("from_lon", String(start[1]));
      }
      if (end) {
        route.set("to_lat", String(end[0]));
        route.set("to_lon", String(end[1]));
      }
      const shadows = new URLSearchParams({ date, time });
      setStatus("Loading...");
      try {
        const get = async (path: string) => {
          const res = await fetch(`${API_URL}${path}`, {
            signal: controller.signal,
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error(
              typeof body?.detail === "string" ? body.detail : `HTTP ${res.status}`,
            );
          }
          return res.json();
        };
        const [r, s] = await Promise.all([
          get(`/route?${route}`),
          get(`/shadows?${shadows}`),
        ]);
        setData({ key: routeKey, route: r, shadows: s });
        setStatus("");
      } catch (e) {
        if (controller.signal.aborted) return;
        setStatus(`Request failed: ${e instanceof Error ? e.message : e}`);
      }
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [date, minutes, wSun, cloud, start, end, routeKey]);

  const r = data?.route;
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
        scrollWheelZoom
        zoom={16}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {data && (
          <>
            <GeoJSON
              key={`shadows-${date}-${minutes}`}
              data={data.shadows}
              style={{ color: "#222", weight: 0, fillOpacity: 0.35 }}
            />
            {data.key === routeKey && (
              <>
            <GeoJSON
              key={`fast-${routeKey}`}
              data={data.route.fastest.geometry}
              style={{ color: "#d1342f", weight: 5, opacity: 0.85 }}
            />
            <GeoJSON
              key={`ctx-${routeKey}`}
              data={data.route.contextroute.geometry}
              style={{ color: "#1f8f3a", weight: 5, opacity: 0.9 }}
            />
              </>
            )}
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

      <aside className="route-panel">
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
            onChange={(e) => setMinutes(Number(e.target.value))}
          />
        </label>
        <label>
          Sun avoidance: {wSun}
          <input
            type="range"
            min={0}
            max={10}
            step={0.5}
            value={wSun}
            onChange={(e) => setWSun(Number(e.target.value))}
          />
        </label>
        <label>
          Cloud cover: {cloud}
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={cloud}
            onChange={(e) => setCloud(Number(e.target.value))}
          />
        </label>
        {r && (
          <>
            <p className="route-sun">
              {r.sun.is_daylight
                ? `Sun elevation ${r.sun.elevation_deg.toFixed(0)}° · azimuth ${r.sun.azimuth_deg.toFixed(0)}°`
                : "Sun is below the horizon"}
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
              {signed(r.extra_seconds)} sec, {signed(r.sun_percent_change)} pts
              sun exposure
            </p>
          </>
        )}
        {status && <p className="route-status">{status}</p>}
      </aside>
    </>
  );
}
