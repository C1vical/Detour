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
  showRain,
}: {
  kind: "ctx" | "fast";
  stats: RouteStats;
  delta?: string;
  showRain: boolean;
}) {
  const pct = (p: number) => Math.min(100, Math.max(0, Math.round(p)));
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
          <dd>{pct(stats.sun_percent)}%</dd>
        </div>
        {showRain && (
          <div>
            <dt>Rain</dt>
            <dd>{pct(stats.rain_percent)}%</dd>
          </div>
        )}
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
  showRain,
}: {
  detour: RouteStats;
  fastest: RouteStats;
  extraSeconds: number;
  showRain: boolean;
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
      <RouteSummary kind="ctx" stats={detour} delta={delta} showRain={showRain} />
      <RouteSummary kind="fast" stats={fastest} showRain={showRain} />
    </div>
  );
}
