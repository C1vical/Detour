import { effortLabel, formatClock, formatDistance, formatMinutes, formatPercent } from "@/lib/format";
import { ROUTE_COLORS } from "@/lib/modes";
import type { RouteCandidate } from "@/lib/mockRouting/types";
import { ClockIcon, MountainIcon, RainIcon, RulerIcon, SunIcon } from "../icons";

function Meter({ value, color }: { value: number; color: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${Math.max(2, value * 100)}%`, backgroundColor: color }} />
    </div>
  );
}

export default function RouteStats({ route, isRecommended }: { route: RouteCandidate; isRecommended: boolean }) {
  const effort = effortLabel(route.elevationEffort);
  const effortSegments = effort === "Low" ? 1 : effort === "Moderate" ? 2 : 3;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold text-slate-600">
          <span className="h-1.5 w-5 rounded-full" style={{ backgroundColor: ROUTE_COLORS[route.strategy] }} />
          {route.label} route
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase ${
            isRecommended ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
          }`}
        >
          {isRecommended ? "Recommended" : "Alternative"}
        </span>
      </div>

      <div className="flex items-end gap-6">
        <div>
          <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <ClockIcon className="size-3.5" /> Walking time
          </p>
          <p className="text-4xl font-semibold tracking-tight text-slate-900 tabular-nums">{formatMinutes(route.walkingTime)}</p>
          <p className="text-xs text-slate-400 tabular-nums">{formatClock(route.walkingTime)} exact</p>
        </div>
        <div className="pb-4">
          <p className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <RulerIcon className="size-3.5" /> Distance
          </p>
          <p className="text-2xl font-semibold tracking-tight text-slate-900 tabular-nums">{formatDistance(route.distance)}</p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-amber-50/70 p-2.5">
          <p className="flex items-center gap-1 text-[11px] font-medium text-amber-700">
            <SunIcon className="size-3.5" /> Sun
          </p>
          <p className="my-1 text-lg font-semibold text-slate-900 tabular-nums">{formatPercent(route.sunExposure)}</p>
          <Meter value={route.sunExposure} color="#f59e0b" />
        </div>
        <div className="rounded-xl bg-sky-50/70 p-2.5">
          <p className="flex items-center gap-1 text-[11px] font-medium text-sky-700">
            <RainIcon className="size-3.5" /> Rain
          </p>
          <p className="my-1 text-lg font-semibold text-slate-900 tabular-nums">{formatPercent(route.rainExposure)}</p>
          <Meter value={route.rainExposure} color="#0ea5e9" />
        </div>
        <div className="rounded-xl bg-violet-50/70 p-2.5">
          <p className="flex items-center gap-1 text-[11px] font-medium text-violet-700">
            <MountainIcon className="size-3.5" /> Effort
          </p>
          <p className="my-1 text-lg font-semibold text-slate-900">{effort}</p>
          <div className="flex gap-1">
            {[1, 2, 3].map((n) => (
              <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= effortSegments ? "bg-violet-500" : "bg-slate-200"}`} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
