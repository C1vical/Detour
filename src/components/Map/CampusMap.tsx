"use client";

import { LOCATIONS, LOCATION_BY_ID, MAP_NODES, WALKWAYS, type LocationId } from "@/lib/campus";
import { ROUTE_COLORS } from "@/lib/modes";
import type { Conditions, RouteCandidate } from "@/lib/mockRouting/types";
import {
  BUILDINGS,
  COMMON,
  GREEN_AREAS,
  LABELS,
  MAP_HEIGHT,
  MAP_WIDTH,
  POND,
  SHADOW_OFFSET,
  STATIONS,
  scatterTrees,
} from "./campusLayout";

interface CampusMapProps {
  candidates: RouteCandidate[];
  selectedId: string;
  onSelect: (id: string) => void;
  start: LocationId;
  destination: LocationId;
  conditions: Conditions;
  dimmed?: boolean;
}

const TREES = GREEN_AREAS.map((area, i) => scatterTrees(97 + i * 131, area.trees, area.box));

const toPoints = (path: string[]) =>
  path
    .map((id) => MAP_NODES[id])
    .filter(Boolean)
    .map((p) => `${p.x},${p.y}`)
    .join(" ");

const TINTS: Record<string, { fill: string; opacity: number }[]> = {
  morning: [{ fill: "#fb923c", opacity: 0.07 }],
  noon: [{ fill: "#fde047", opacity: 0.05 }],
  evening: [{ fill: "#4338ca", opacity: 0.12 }],
  cloudy: [{ fill: "#64748b", opacity: 0.1 }],
  rain: [{ fill: "#1e3a8a", opacity: 0.1 }],
};

export default function CampusMap({
  candidates,
  selectedId,
  onSelect,
  start,
  destination,
  conditions,
  dimmed,
}: CampusMapProps) {
  const shadow = SHADOW_OFFSET[conditions.timeOfDay];
  const selected = candidates.find((c) => c.id === selectedId);
  const others = candidates.filter((c) => c.id !== selectedId);
  const tints = [...TINTS[conditions.timeOfDay], ...(TINTS[conditions.weather] ?? [])];
  const closed = conditions.closeCentralWalkway;

  return (
    <svg
      viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      className="h-full w-full select-none"
      role="img"
      aria-label="Schematic map of York University Keele campus with candidate walking routes"
    >
      <defs>
        <pattern id="hatch-covered" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill="#e0e7ff" />
          <line x1="0" y1="0" x2="0" y2="5" stroke="#a5b4fc" strokeWidth="2" />
        </pattern>
        <pattern id="hazard" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="10" height="10" fill="#facc15" />
          <rect width="5" height="10" fill="#1f2937" />
        </pattern>
        <pattern id="rain" width="26" height="26" patternUnits="userSpaceOnUse">
          <path d="M4 2 l-3 8 M17 11 l-3 8 M11 20 l-2 5" stroke="#1d4ed8" strokeWidth="1.2" strokeLinecap="round" />
        </pattern>
        <pattern id="lawn" width="8" height="8" patternUnits="userSpaceOnUse">
          <rect width="8" height="8" fill="#d6ebc6" />
          <circle cx="2" cy="2" r="0.8" fill="#bcdba5" />
        </pattern>
        {GREEN_AREAS.map((a) => (
          <clipPath key={a.id} id={`clip-${a.id}`}>
            <path d={a.d} />
          </clipPath>
        ))}
        <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2.5" floodColor="#0f172a" floodOpacity="0.25" />
        </filter>
      </defs>

      {/* Ground */}
      <rect width={MAP_WIDTH} height={MAP_HEIGHT} fill="#eef1e8" />

      {/* Roads */}
      <g fill="none" strokeLinecap="round">
        <path d="M0,28 H1000" stroke="#d4d4d0" strokeWidth="22" />
        <path d="M968,0 V640" stroke="#d4d4d0" strokeWidth="22" />
        <path d="M30,140 C30,420 40,600 220,622 H1000" stroke="#dcdcd6" strokeWidth="14" />
        <path d="M0,28 H1000 M968,0 V640" stroke="#fafaf7" strokeWidth="1.5" strokeDasharray="10 10" />
      </g>
      <g className="map-road-label" fontSize="10" fill="#78716c" fontWeight="600" letterSpacing="2">
        <text x="560" y="31.5">STEELES AVE W</text>
        <text x="971.5" y="330" transform="rotate(90 971.5 330)" textAnchor="middle">
          KEELE ST
        </text>
        <text x="760" y="625.5">THE POND RD</text>
        <text x="33" y="330" transform="rotate(-90 33 330)" textAnchor="middle">
          IAN MACDONALD BLVD
        </text>
      </g>

      {/* Subway Line 1 (underground) */}
      <path
        d="M90,100 C150,170 300,250 395,335 C420,360 440,420 430,640"
        fill="none"
        stroke="#eab308"
        strokeWidth="3"
        strokeDasharray="2 7"
        strokeLinecap="round"
        opacity="0.75"
      />
      <text x="300" y="268" fontSize="9" fill="#a16207" fontWeight="600" transform="rotate(38 300 268)">
        LINE 1 · UNDERGROUND
      </text>

      {/* Greenery */}
      <rect {...COMMON} rx="16" fill="url(#lawn)" stroke="#bcdba5" />
      <text x={COMMON.x + COMMON.w / 2} y={COMMON.y + 27} textAnchor="middle" fontSize="8" fill="#4d7c0f" fontWeight="600" letterSpacing="0.5">
        <tspan x={COMMON.x + COMMON.w / 2}>HARRY W. ARTHURS</tspan>
        <tspan x={COMMON.x + COMMON.w / 2} dy="11">COMMON</tspan>
      </text>
      {GREEN_AREAS.map((a, i) => (
        <g key={a.id}>
          <path d={a.d} fill="#cfe5bd" stroke="#b5d69c" strokeWidth="1.5" />
          <g clipPath={`url(#clip-${a.id})`}>
            {TREES[i].map((t, j) => (
              <g key={j}>
                <circle cx={t.x + 1.5} cy={t.y + 2} r={t.r} fill="#7aa66a" opacity="0.35" />
                <circle cx={t.x} cy={t.y} r={t.r} fill="#9cc98a" />
                <circle cx={t.x - t.r * 0.3} cy={t.y - t.r * 0.3} r={t.r * 0.45} fill="#b4d9a3" />
              </g>
            ))}
          </g>
        </g>
      ))}
      <ellipse {...POND} fill="#bfdbfe" stroke="#93c5fd" strokeWidth="1.5" />
      <text x={POND.cx} y={POND.cy + 4} textAnchor="middle" fontSize="9" fill="#1d4ed8" fontWeight="600">
        Stong Pond
      </text>

      {/* Building shadows (shift with time of day) */}
      <g fill="#0f172a" opacity="0.13" className="transition-transform duration-700" style={{ transform: `translate(${shadow.dx}px, ${shadow.dy}px)` }}>
        {BUILDINGS.map((b, i) =>
          b.shape === "circle" ? (
            <circle key={i} cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={b.w / 2} />
          ) : (
            <rect key={i} x={b.x} y={b.y} width={b.w} height={b.h} rx="5" />
          ),
        )}
      </g>

      {/* Walkways */}
      <g fill="none" strokeLinecap="round">
        {WALKWAYS.map((w, i) => {
          const a = MAP_NODES[w.from];
          const b = MAP_NODES[w.to];
          const covered = w.covered >= 0.6;
          return (
            <line
              key={`o${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={covered ? "#a5b4fc" : "#cfd6c8"}
              strokeWidth={w.central ? 16 : covered ? 14 : 10}
            />
          );
        })}
        {WALKWAYS.map((w, i) => {
          const a = MAP_NODES[w.from];
          const b = MAP_NODES[w.to];
          const covered = w.covered >= 0.6;
          return (
            <line
              key={`f${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={covered ? "url(#hatch-covered)" : w.central ? "#f7f1e3" : "#fbfaf6"}
              strokeWidth={w.central ? 13 : covered ? 11 : 7}
            />
          );
        })}
        {closed &&
          WALKWAYS.filter((w) => w.central).map((w, i) => {
            const a = MAP_NODES[w.from];
            const b = MAP_NODES[w.to];
            return (
              <line key={`c${i}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="url(#hazard)" strokeWidth="11" strokeLinecap="butt" opacity="0.9" />
            );
          })}
      </g>
      <text
        x="505"
        y="333"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        letterSpacing="2"
        fill={closed ? "#b45309" : "#a8a29e"}
        className="map-label"
      >
        {closed ? "CENTRAL WALKWAY · CLOSED" : "CENTRAL WALKWAY"}
      </text>

      {/* Buildings */}
      <g>
        {BUILDINGS.map((b, i) => {
          const fill = b.landmark ? "#ffffff" : "#dfe3ea";
          const stroke = b.landmark ? "#94a3b8" : "#cbd2dc";
          return (
            <g key={i}>
              {b.shape === "circle" ? (
                <>
                  <circle cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={b.w / 2} fill={fill} stroke={stroke} strokeWidth="1.5" />
                  <circle cx={b.x + b.w / 2} cy={b.y + b.h / 2} r={b.w / 2 - 7} fill="none" stroke="#e2e8f0" strokeWidth="1.5" />
                </>
              ) : (
                <rect x={b.x} y={b.y} width={b.w} height={b.h} rx="5" fill={fill} stroke={stroke} strokeWidth="1.5" />
              )}
              {b.landmark && b.shape !== "circle" && (
                <rect x={b.x} y={b.y} width={b.w} height="4" rx="2" fill="#e31837" opacity="0.85" />
              )}
              {b.name && (
                <text x={b.x + b.w / 2} y={b.y + b.h / 2 + 3} textAnchor="middle" fontSize="8" fill="#64748b" fontWeight="500">
                  {b.name}
                </text>
              )}
            </g>
          );
        })}
      </g>

      {/* Stations */}
      {STATIONS.map((id) => {
        const p = MAP_NODES[id];
        return (
          <g key={id} transform={`translate(${p.x} ${p.y})`}>
            <circle r="12" fill="#ffffff" stroke="#eab308" strokeWidth="3" />
            <text y="4" textAnchor="middle" fontSize="11" fontWeight="800" fill="#1f2937">
              1
            </text>
          </g>
        );
      })}

      {/* Conditions tint */}
      <g pointerEvents="none">
        {/* Oversized so the tint also covers the letterboxed area around the viewBox. */}
        {tints.map((t, i) => (
          <rect key={i} x={-MAP_WIDTH} y={-MAP_HEIGHT} width={MAP_WIDTH * 3} height={MAP_HEIGHT * 3} fill={t.fill} opacity={t.opacity} className="transition-opacity duration-700" />
        ))}
        {conditions.weather === "rain" && (
          <rect x={-MAP_WIDTH} y={-MAP_HEIGHT - 26} width={MAP_WIDTH * 3} height={MAP_HEIGHT * 3 + 26} fill="url(#rain)" opacity="0.35" className="map-rain" />
        )}
      </g>

      {/* Routes */}
      <g fill="none" strokeLinecap="round" strokeLinejoin="round" opacity={dimmed ? 0.35 : 1} className="transition-opacity duration-300">
        {others.map((c) => (
          <g key={c.id} className="cursor-pointer" onClick={() => onSelect(c.id)}>
            <title>{`${c.label} route — click to view`}</title>
            <polyline points={toPoints(c.path)} stroke="transparent" strokeWidth="22" />
            <polyline points={toPoints(c.path)} stroke="#ffffff" strokeWidth="8" opacity="0.7" />
            <polyline
              points={toPoints(c.path)}
              stroke={ROUTE_COLORS[c.strategy]}
              strokeWidth="5"
              strokeDasharray="1 9"
              opacity="0.9"
              className="transition-opacity hover:opacity-100"
            />
          </g>
        ))}
        {selected && (
          <g key={`${selected.id}-${selected.path.join(">")}`} filter="url(#soft-shadow)">
            <polyline points={toPoints(selected.path)} stroke="#ffffff" strokeWidth="13" />
            <polyline
              points={toPoints(selected.path)}
              stroke={ROUTE_COLORS[selected.strategy]}
              strokeWidth="8"
              pathLength={1}
              className="route-draw"
            />
            <polyline points={toPoints(selected.path)} stroke="#ffffff" strokeWidth="2" strokeDasharray="2 14" opacity="0.85" className="route-flow" />
          </g>
        )}
      </g>

      {/* Location dots + labels */}
      {LOCATIONS.map((loc) => {
        const p = MAP_NODES[loc.id];
        const label = LABELS[loc.id];
        const active = loc.id === start || loc.id === destination;
        return (
          <g key={loc.id}>
            {!STATIONS.includes(loc.id) && !active && (
              <circle cx={p.x} cy={p.y} r="4.5" fill="#ffffff" stroke="#475569" strokeWidth="2" />
            )}
            <text
              x={label.x}
              y={label.y}
              textAnchor={label.anchor ?? "middle"}
              fontSize="11.5"
              fontWeight={active ? 700 : 600}
              fill={active ? "#0f172a" : "#334155"}
              className="map-label"
            >
              {LOCATION_BY_ID[loc.id].shortName}
            </text>
          </g>
        );
      })}

      {/* Markers */}
      <StartMarker id={start} />
      <DestinationMarker id={destination} />
    </svg>
  );
}

function StartMarker({ id }: { id: LocationId }) {
  const p = MAP_NODES[id];
  return (
    <g transform={`translate(${p.x} ${p.y})`} filter="url(#soft-shadow)">
      <circle r="11" fill="#0f172a" opacity="0.25" className="marker-pulse" />
      <circle r="11" fill="#ffffff" />
      <circle r="7.5" fill="#0f172a" />
      <circle r="2.8" fill="#ffffff" />
    </g>
  );
}

function DestinationMarker({ id }: { id: LocationId }) {
  const p = MAP_NODES[id];
  return (
    <g transform={`translate(${p.x} ${p.y})`} filter="url(#soft-shadow)">
      <path d="M0,0 C-4,-9 -13,-14 -13,-23 A13,13 0 1 1 13,-23 C13,-14 4,-9 0,0 Z" fill="#e31837" stroke="#ffffff" strokeWidth="2" />
      <circle cy="-23" r="5" fill="#ffffff" />
    </g>
  );
}
