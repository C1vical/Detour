import { formatMinutes, formatPercent } from "@/lib/format";
import { ROUTE_COLORS } from "@/lib/modes";
import type { Conditions, RouteCandidate } from "@/lib/mockRouting/types";
import { CloudIcon, MoonIcon, RainIcon, SunIcon, SunriseIcon } from "../icons";

export function RouteChips({
  candidates,
  selectedId,
  recommendedId,
  onSelect,
}: {
  candidates: RouteCandidate[];
  selectedId: string;
  recommendedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-2xl border border-white/60 bg-white/85 p-1.5 shadow-lg shadow-slate-900/10 backdrop-blur">
      <p className="px-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase sm:hidden 2xl:block">
        {candidates.length} {candidates.length === 1 ? "route" : "routes"}
      </p>
      <div className="flex flex-wrap gap-1">
        {candidates.map((c) => {
          const active = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onSelect(c.id)}
              className={`flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-left text-xs transition sm:text-sm ${
                active ? "bg-slate-900 text-white shadow" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: ROUTE_COLORS[c.strategy] }} />
              <span className="font-medium">{c.label}</span>
              {c.id === recommendedId && (
                <span
                  className={`rounded-full px-1.5 py-px text-[10px] font-semibold ${
                    active ? "bg-white/15 text-white" : "bg-emerald-100 text-emerald-700"
                  }`}
                >
                  Best
                </span>
              )}
              <span className={`ml-auto pl-1 tabular-nums ${active ? "text-white/70" : "text-slate-500"}`}>
                {formatMinutes(c.walkingTime)}
                <span className="sm:hidden 2xl:inline">
                  {" "}
                  · {formatPercent(c.sunExposure)}
                  <SunIcon className="ml-0.5 inline size-3 -translate-y-px" />
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const TIME_LABEL = { morning: "Morning", noon: "Noon", evening: "Evening" } as const;
const WEATHER_LABEL = { sunny: "Sunny", cloudy: "Cloudy", rain: "Rain" } as const;

export function ConditionsBadge({ conditions }: { conditions: Conditions }) {
  const TimeIcon = conditions.timeOfDay === "morning" ? SunriseIcon : conditions.timeOfDay === "evening" ? MoonIcon : SunIcon;
  const WeatherIcon = conditions.weather === "rain" ? RainIcon : conditions.weather === "cloudy" ? CloudIcon : SunIcon;
  return (
    <div className="flex items-center gap-3 rounded-full border border-white/60 bg-white/85 px-3.5 py-1.5 text-xs font-medium text-slate-700 shadow-lg shadow-slate-900/10 backdrop-blur">
      <span className="flex items-center gap-1.5">
        <TimeIcon className="size-3.5 text-amber-500" />
        {TIME_LABEL[conditions.timeOfDay]}
      </span>
      <span className="h-3 w-px bg-slate-300" />
      <span className="flex items-center gap-1.5">
        <WeatherIcon className="size-3.5 text-sky-600" />
        {WEATHER_LABEL[conditions.weather]}
      </span>
      {conditions.closeCentralWalkway && (
        <>
          <span className="h-3 w-px bg-slate-300" />
          <span className="font-semibold text-amber-700">Walkway closed</span>
        </>
      )}
    </div>
  );
}

export function MapLegend() {
  const item = "flex items-center gap-2";
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 rounded-2xl border border-white/60 bg-white/85 px-3.5 py-2.5 text-[11px] text-slate-600 shadow-lg shadow-slate-900/10 backdrop-blur">
      <span className={item}>
        <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: ROUTE_COLORS.fast }} /> Fastest / open
      </span>
      <span className={item}>
        <span className="size-3 rounded-full border border-[#b5d69c] bg-[#9cc98a]" /> Tree shade
      </span>
      <span className={item}>
        <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: ROUTE_COLORS.shaded }} /> Shaded
      </span>
      <span className={item}>
        <span className="h-2 w-4 rounded-sm border border-indigo-300 bg-[repeating-linear-gradient(45deg,#e0e7ff_0_2px,#a5b4fc_2px_4px)]" />{" "}
        Covered / indoor
      </span>
      <span className={item}>
        <span className="h-1.5 w-4 rounded-full" style={{ backgroundColor: ROUTE_COLORS.covered }} /> Covered
      </span>
      <span className={item}>
        <span className="flex size-3 items-center justify-center rounded-full border-2 border-yellow-500 bg-white text-[7px] font-bold">
          1
        </span>
        Subway station
      </span>
    </div>
  );
}
