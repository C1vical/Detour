import { MODES } from "@/lib/modes";
import type { RouteMode } from "@/lib/mockRouting/types";
import { BoltIcon, CheckIcon, SlidersIcon, TreeIcon, UmbrellaIcon } from "../icons";

const MODE_ICONS = {
  fastest: BoltIcon,
  cool: TreeIcon,
  dry: UmbrellaIcon,
  comfortable: SlidersIcon,
} as const;

export default function ModeSelector({ value, onChange }: { value: RouteMode; onChange: (mode: RouteMode) => void }) {
  return (
    <div role="radiogroup" aria-label="Route mode" className="grid grid-cols-2 gap-2">
      {MODES.map((mode) => {
        const Icon = MODE_ICONS[mode.id];
        const active = mode.id === value;
        return (
          <button
            key={mode.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(mode.id)}
            className={`relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition duration-200 ${
              active
                ? `${mode.activeClass} shadow-sm ring-4`
                : "border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-sm"
            }`}
          >
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-lg ${mode.iconClass}`}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0">
              <span className="block pr-5 text-sm font-semibold text-slate-900">{mode.title}</span>
              <span className="mt-0.5 block text-xs leading-snug text-slate-500">{mode.description}</span>
            </span>
            {active && (
              <span className="absolute top-2 right-2 flex size-4 items-center justify-center rounded-full bg-slate-900 text-white">
                <CheckIcon className="size-2.5" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
