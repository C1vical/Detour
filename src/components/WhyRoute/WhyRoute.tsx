import type { RouteExplanation } from "@/lib/explainRoute";
import type { CostBreakdown } from "@/lib/mockRouting/types";
import { BulbIcon, CheckIcon } from "../icons";

const FACTORS: { key: keyof CostBreakdown; label: string; color: string }[] = [
  { key: "timeCost", label: "Time", color: "#e2e8f0" },
  { key: "sunCost", label: "Sun", color: "#fbbf24" },
  { key: "rainCost", label: "Rain", color: "#38bdf8" },
  { key: "elevationCost", label: "Effort", color: "#a78bfa" },
];

export default function WhyRoute({
  explanation,
  breakdown,
  totalCost,
}: {
  explanation: RouteExplanation;
  breakdown: CostBreakdown;
  totalCost: number;
}) {
  return (
    <section className="relative overflow-hidden rounded-2xl bg-slate-900 p-5 text-white shadow-xl shadow-slate-900/20">
      <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-emerald-400/20 blur-3xl" />
      <h2 className="flex items-center gap-2 text-xs font-semibold tracking-wider text-emerald-300 uppercase">
        <BulbIcon className="size-4" /> Why this route?
      </h2>
      <p className="mt-2 text-lg leading-snug font-semibold text-balance">{explanation.headline}</p>
      {explanation.points.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {explanation.points.map((p) => (
            <li key={p} className="flex items-start gap-2 text-sm text-slate-300">
              <CheckIcon className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
              {p}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-white/10 pt-4">
        <div className="mb-2.5 flex items-baseline justify-between">
          <p className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">Cost breakdown</p>
          <p className="text-[11px] text-slate-400 tabular-nums">total {totalCost.toFixed(1)}</p>
        </div>
        <div className="mb-3 flex h-2 overflow-hidden rounded-full bg-white/10">
          {FACTORS.map((f) => (
            <div
              key={f.key}
              className="h-full transition-[width] duration-700 ease-out"
              style={{ width: `${totalCost > 0 ? (breakdown[f.key] / totalCost) * 100 : 0}%`, backgroundColor: f.color }}
            />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-2">
          {FACTORS.map((f) => (
            <div key={f.key}>
              <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <span className="size-2 rounded-full" style={{ backgroundColor: f.color }} />
                {f.label}
              </p>
              <p className="text-sm font-semibold tabular-nums">
                {totalCost > 0 ? Math.round((breakdown[f.key] / totalCost) * 100) : 0}%
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
