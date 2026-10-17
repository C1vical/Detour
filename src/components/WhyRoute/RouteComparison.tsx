import { effortLabel, formatClock, formatPercent } from "@/lib/format";
import { ROUTE_COLORS } from "@/lib/modes";
import type { RouteCandidate } from "@/lib/mockRouting/types";

interface Row {
  label: string;
  a: string;
  b: string;
  /** Which side is better: -1 = a, 1 = b, 0 = tie. */
  better: number;
}

const cmp = (a: number, b: number) => (Math.abs(a - b) < 0.005 ? 0 : a < b ? -1 : 1);

export default function RouteComparison({
  selected,
  other,
  otherTitle,
}: {
  selected: RouteCandidate;
  other: RouteCandidate;
  otherTitle: string;
}) {
  const rows: Row[] = [
    { label: "Time", a: formatClock(selected.walkingTime), b: formatClock(other.walkingTime), better: cmp(selected.walkingTime, other.walkingTime) },
    { label: "Sun", a: formatPercent(selected.sunExposure), b: formatPercent(other.sunExposure), better: cmp(selected.sunExposure, other.sunExposure) },
    { label: "Rain", a: formatPercent(selected.rainExposure), b: formatPercent(other.rainExposure), better: cmp(selected.rainExposure, other.rainExposure) },
    {
      label: "Effort",
      a: effortLabel(selected.elevationEffort),
      b: effortLabel(other.elevationEffort),
      better: cmp(selected.elevationEffort, other.elevationEffort),
    },
  ];

  const cell = (text: string, win: boolean) => (
    <span className={`rounded-md px-2 py-0.5 text-right tabular-nums ${win ? "bg-emerald-50 font-semibold text-emerald-700" : "text-slate-700"}`}>
      {text}
    </span>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-xs font-semibold tracking-wider text-slate-500 uppercase">Tradeoff at a glance</h2>
      <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-2 text-sm">
        <span />
        <span className="flex items-center justify-end gap-1.5 text-xs font-semibold text-slate-900">
          <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: ROUTE_COLORS[selected.strategy] }} />
          Selected
        </span>
        <span className="flex items-center justify-end gap-1.5 text-xs font-semibold text-slate-500">
          <span className="h-1.5 w-3 rounded-full" style={{ backgroundColor: ROUTE_COLORS[other.strategy] }} />
          {otherTitle}
        </span>
        {rows.map((r) => (
          <div key={r.label} className="contents">
            <span className="text-xs text-slate-500">{r.label}</span>
            {cell(r.a, r.better === -1)}
            {cell(r.b, r.better === 1)}
          </div>
        ))}
      </div>
    </section>
  );
}
