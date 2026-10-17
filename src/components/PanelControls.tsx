// Presentation-only pieces of the route panel. Everything here formats or
// displays values that CampusMap already has; no routing logic lives here.
import type { CSSProperties, ReactNode } from "react";

import type { RouteStats } from "@/lib/route";

// "1 min 19 sec", "45 sec", "2 min"
export function fmtSpan(seconds: number) {
  const s = Math.round(Math.abs(seconds));
  const m = Math.floor(s / 60);
  if (m === 0) return `${s} sec`;
  return s % 60 ? `${m} min ${s % 60} sec` : `${m} min`;
}

function fmtDistance(m: number) {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

type SliderProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (v: number) => void;
};

export function Slider({ label, value, min, max, step, display, onChange }: SliderProps) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <label className="field">
      <span className="field-row">
        <span className="field-label">{label}</span>
        <span className="field-value">{display}</span>
      </span>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={display}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function Switch({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="switch-field">
      <span>{children}</span>
      <input
        type="checkbox"
        role="switch"
        className="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}

function RouteSummary({
  kind,
  stats,
  delta,
}: {
  kind: "ctx" | "fast";
  stats: RouteStats;
  delta?: string;
}) {
  const sun = Math.min(100, Math.max(0, Math.round(stats.sun_percent)));
  return (
    <div className={`route-summary route-summary-${kind}`}>
      <p className="route-summary-name">
        <span className={`line-key line-key-${kind}`} aria-hidden="true" />
        {kind === "ctx" ? "Detour" : "Fastest"}
      </p>
      <p className="route-summary-time">{fmtSpan(stats.seconds)}</p>
      <p className="route-summary-delta">{delta ?? " "}</p>
      <dl className="route-summary-meta">
        <div>
          <dt>Distance</dt>
          <dd>{fmtDistance(stats.distance_m)}</dd>
        </div>
        <div>
          <dt>Sun</dt>
          <dd>{sun}%</dd>
        </div>
      </dl>
    </div>
  );
}

// Detour and Fastest side by side; Detour first and emphasised. The delta
// line uses the backend's extra_seconds as-is.
export function RoutePair({
  detour,
  fastest,
  extraSeconds,
}: {
  detour: RouteStats;
  fastest: RouteStats;
  extraSeconds: number;
}) {
  const extra = Math.round(extraSeconds);
  const delta =
    extra > 0
      ? `+${fmtSpan(extra)} vs fastest`
      : extra < 0
        ? `${fmtSpan(extra)} faster`
        : "No extra time";
  return (
    <div className="route-pair">
      <RouteSummary kind="ctx" stats={detour} delta={delta} />
      <RouteSummary kind="fast" stats={fastest} />
    </div>
  );
}

export function LogoMark() {
  return (
    <svg className="logo-mark" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="17" cy="7" r="3.2" fill="currentColor" />
      <path
        d="M5 19V14C5 11.2 7.2 9 10 9H12"
        fill="none"
        stroke="#ffffff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5" cy="19" r="1.6" fill="#ffffff" />
    </svg>
  );
}
