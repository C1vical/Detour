import { LOCATIONS, type LocationId } from "@/lib/campus";
import { ChevronIcon } from "../icons";

interface LocationSelectProps {
  label: string;
  value: LocationId;
  onChange: (id: LocationId) => void;
  marker: "start" | "destination";
}

export default function LocationSelect({ label, value, onChange, marker }: LocationSelectProps) {
  return (
    <label className="group relative flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 transition focus-within:border-slate-400 focus-within:ring-4 focus-within:ring-slate-900/5 hover:border-slate-300">
      {marker === "start" ? (
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-slate-900">
          <span className="size-1.5 rounded-full bg-white" />
        </span>
      ) : (
        <span className="size-4 shrink-0 rounded-full rounded-br-none bg-[#e31837] rotate-45" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[10px] font-semibold tracking-wider text-slate-400 uppercase">{label}</span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as LocationId)}
          className="w-full cursor-pointer appearance-none truncate bg-transparent pr-14 text-sm font-medium text-slate-900 outline-none"
        >
          {LOCATIONS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </span>
      <ChevronIcon className="pointer-events-none absolute right-3 size-4 text-slate-400" />
    </label>
  );
}
