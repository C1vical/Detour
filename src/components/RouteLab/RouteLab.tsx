import type { Conditions, TimeOfDay, Weather } from "@/lib/mockRouting/types";
import { CloudIcon, ConeIcon, FlaskIcon, MoonIcon, RainIcon, SunIcon, SunriseIcon } from "../icons";

const TIMES: { id: TimeOfDay; label: string; Icon: typeof SunIcon }[] = [
  { id: "morning", label: "Morning", Icon: SunriseIcon },
  { id: "noon", label: "Noon", Icon: SunIcon },
  { id: "evening", label: "Evening", Icon: MoonIcon },
];

const WEATHERS: { id: Weather; label: string; Icon: typeof SunIcon }[] = [
  { id: "sunny", label: "Sunny", Icon: SunIcon },
  { id: "cloudy", label: "Cloudy", Icon: CloudIcon },
  { id: "rain", label: "Rain", Icon: RainIcon },
];

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: T; label: string; Icon: typeof SunIcon }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{label}</p>
      <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
        {options.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-pressed={id === value}
            className={`flex items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap transition ${
              id === value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
            }`}
          >
            <Icon className="size-3.5 shrink-0" />
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "What if?" controls. UI only — the simulation team's model consumes `Conditions`. */
export default function RouteLab({ conditions, onChange }: { conditions: Conditions; onChange: (c: Conditions) => void }) {
  const set = (patch: Partial<Conditions>) => onChange({ ...conditions, ...patch });

  return (
    <section className="flex flex-col gap-3 2xl:flex-row 2xl:items-end 2xl:gap-5">
      <div className="flex shrink-0 items-center gap-2.5 2xl:pb-1">
        <span className="flex size-8 items-center justify-center rounded-lg bg-fuchsia-100 text-fuchsia-700">
          <FlaskIcon className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-semibold text-slate-900">RouteLab</span>
          <span className="block text-[11px] text-slate-500">What if conditions change?</span>
        </span>
      </div>
      <div className="grid flex-1 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Segmented label="Time of day" options={TIMES} value={conditions.timeOfDay} onChange={(timeOfDay) => set({ timeOfDay })} />
        <Segmented label="Weather" options={WEATHERS} value={conditions.weather} onChange={(weather) => set({ weather })} />
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2">
          <ConeIcon className="size-4 shrink-0 text-amber-600" />
          <span className="flex-1 text-xs font-medium whitespace-nowrap text-slate-800">Close Central Walkway</span>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={conditions.closeCentralWalkway}
            onChange={(e) => set({ closeCentralWalkway: e.target.checked })}
          />
          <span className="relative h-5 w-9 shrink-0 rounded-full bg-slate-200 transition peer-checked:bg-amber-500 peer-focus-visible:ring-4 peer-focus-visible:ring-amber-500/30 after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
        </label>
      </div>
    </section>
  );
}
