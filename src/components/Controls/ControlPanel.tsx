import type { LocationId } from "@/lib/campus";
import type { RouteMode } from "@/lib/mockRouting/types";
import { NavigationIcon, SwapIcon } from "../icons";
import LocationSelect from "./LocationSelect";
import ModeSelector from "./ModeSelector";

interface ControlPanelProps {
  start: LocationId;
  destination: LocationId;
  mode: RouteMode;
  loading: boolean;
  stale: boolean;
  onStartChange: (id: LocationId) => void;
  onDestinationChange: (id: LocationId) => void;
  onSwap: () => void;
  onModeChange: (mode: RouteMode) => void;
  onFindRoute: () => void;
}

export default function ControlPanel(props: ControlPanelProps) {
  const sameLocation = props.start === props.destination;
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="mb-2.5 text-xs font-semibold tracking-wider text-slate-500 uppercase">Plan your walk</h2>
        <div className="relative flex flex-col gap-2">
          <LocationSelect label="Start" marker="start" value={props.start} onChange={props.onStartChange} />
          <LocationSelect
            label="Destination"
            marker="destination"
            value={props.destination}
            onChange={props.onDestinationChange}
          />
          <button
            type="button"
            onClick={props.onSwap}
            aria-label="Swap start and destination"
            className="absolute top-1/2 right-10 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-sm transition hover:rotate-180 hover:text-slate-900"
          >
            <SwapIcon className="size-4" />
          </button>
        </div>
      </div>

      <div>
        <h2 className="mb-2.5 text-xs font-semibold tracking-wider text-slate-500 uppercase">Route mode</h2>
        <ModeSelector value={props.mode} onChange={props.onModeChange} />
      </div>

      <div>
        <button
          type="button"
          onClick={props.onFindRoute}
          disabled={sameLocation || props.loading}
          className={`flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:bg-slate-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 ${
            props.stale && !sameLocation ? "ring-4 ring-[#e31837]/25" : ""
          }`}
        >
          {props.loading ? (
            <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          ) : (
            <NavigationIcon className="size-4" />
          )}
          {props.loading ? "Finding route…" : "Find Best Route"}
        </button>
        {sameLocation ? (
          <p className="mt-2 text-center text-xs text-[#e31837]">Pick two different locations.</p>
        ) : props.stale ? (
          <p className="mt-2 text-center text-xs text-slate-500">Locations changed — update the route.</p>
        ) : null}
      </div>
    </section>
  );
}
