"use client";

import { useRef, useState } from "react";
import type { LocationId } from "@/lib/campus";
import { explainRoute } from "@/lib/explainRoute";
import { getMockRouteResult } from "@/lib/mockRouting/mockRouteResult";
import { findRoutes } from "@/lib/mockRouting/routeService";
import type { Conditions, RouteMode, RouteRequest, RouteResponse } from "@/lib/mockRouting/types";
import ControlPanel from "./Controls/ControlPanel";
import Header from "./Header";
import CampusMap from "./Map/CampusMap";
import { ConditionsBadge, MapLegend, RouteChips } from "./Map/MapOverlays";
import RouteLab from "./RouteLab/RouteLab";
import RouteStats from "./RouteStats/RouteStats";
import RouteComparison from "./WhyRoute/RouteComparison";
import WhyRoute from "./WhyRoute/WhyRoute";

const DEFAULT_REQUEST: RouteRequest = {
  start: "bergeron",
  destination: "lanes",
  mode: "cool",
  conditions: { timeOfDay: "noon", weather: "sunny", closeCentralWalkway: false },
};

// Initial render uses the mock synchronously so the demo opens on a route.
// TODO(backend): drop this and call `run(DEFAULT_REQUEST)` on mount instead.
const INITIAL_RESPONSE = getMockRouteResult(DEFAULT_REQUEST);

export default function ContextRouteApp() {
  const [start, setStart] = useState<LocationId>(DEFAULT_REQUEST.start);
  const [destination, setDestination] = useState<LocationId>(DEFAULT_REQUEST.destination);
  const [mode, setMode] = useState<RouteMode>(DEFAULT_REQUEST.mode);
  const [conditions, setConditions] = useState<Conditions>(DEFAULT_REQUEST.conditions);

  // The request the currently displayed response belongs to.
  const [routed, setRouted] = useState<RouteRequest>(DEFAULT_REQUEST);
  const [response, setResponse] = useState<RouteResponse>(INITIAL_RESPONSE);
  const [selectedId, setSelectedId] = useState(INITIAL_RESPONSE.recommendedId);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latestRequest = useRef(0);

  async function run(request: RouteRequest) {
    const id = ++latestRequest.current;
    setLoading(true);
    setError(null);
    try {
      const result = await findRoutes(request);
      if (id !== latestRequest.current) return;
      setResponse(result);
      setSelectedId(result.recommendedId);
      setRouted(request);
    } catch (e) {
      if (id === latestRequest.current) setError(e instanceof Error ? e.message : "Could not find a route.");
    } finally {
      if (id === latestRequest.current) setLoading(false);
    }
  }

  const stale = start !== routed.start || destination !== routed.destination;

  // Mode and RouteLab tweaks re-run the current route instantly.
  function changeMode(next: RouteMode) {
    setMode(next);
    run({ ...routed, mode: next, conditions });
  }
  function changeConditions(next: Conditions) {
    setConditions(next);
    run({ ...routed, mode, conditions: next });
  }

  const selected = response.candidates.find((c) => c.id === selectedId) ?? response.candidates[0];
  const fastest = response.candidates.find((c) => c.id === response.fastestId) ?? selected;
  const isFastest = selected.id === fastest.id;
  const comparisonTarget = isFastest
    ? response.candidates.filter((c) => c.id !== selected.id).sort((a, b) => a.totalCost - b.totalCost)[0]
    : fastest;
  const explanation = explainRoute(selected, fastest, routed.mode, response.candidates.length);

  return (
    <div className="flex min-h-screen flex-col bg-slate-100 lg:h-screen lg:overflow-hidden">
      <Header />
      <main className="flex flex-1 flex-col-reverse gap-4 p-4 lg:min-h-0 lg:flex-row">
        {/* Sidebar */}
        <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[400px] lg:overflow-y-auto lg:pr-1 [scrollbar-width:thin]">
          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <ControlPanel
              start={start}
              destination={destination}
              mode={mode}
              loading={loading}
              stale={stale}
              onStartChange={setStart}
              onDestinationChange={setDestination}
              onSwap={() => {
                setStart(destination);
                setDestination(start);
              }}
              onModeChange={changeMode}
              onFindRoute={() => run({ start, destination, mode, conditions })}
            />
          </div>

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

          <div key={`${selected.id}-${response.recommendedId}-${routed.start}-${routed.destination}`} className="fade-up flex flex-col gap-4">
            <RouteStats route={selected} isRecommended={selected.id === response.recommendedId} />
            <WhyRoute explanation={explanation} breakdown={selected.breakdown} totalCost={selected.totalCost} />
            {comparisonTarget && (
              <RouteComparison
                selected={selected}
                other={comparisonTarget}
                otherTitle={isFastest ? comparisonTarget.label : "Fastest"}
              />
            )}
          </div>
        </aside>

        {/* Map */}
        <section className="relative flex flex-col overflow-hidden rounded-3xl border border-slate-200 bg-[#eef1e8] shadow-sm lg:min-h-0 lg:flex-1">
          <div className="p-2 pb-0 sm:hidden">
            <RouteChips
              candidates={response.candidates}
              selectedId={selected.id}
              recommendedId={response.recommendedId}
              onSelect={setSelectedId}
            />
          </div>
          <div className="relative aspect-[1000/640] lg:aspect-auto lg:min-h-0 lg:flex-1">
            <div className="absolute inset-0">
              <CampusMap
                candidates={response.candidates}
                selectedId={selected.id}
                onSelect={setSelectedId}
                start={start}
                destination={destination}
                conditions={routed.conditions}
                dimmed={stale}
              />
            </div>

            <div className="pointer-events-none absolute inset-x-3 top-3 hidden items-start justify-between gap-3 sm:flex">
              <div className="pointer-events-auto">
                <RouteChips
                  candidates={response.candidates}
                  selectedId={selected.id}
                  recommendedId={response.recommendedId}
                  onSelect={setSelectedId}
                />
              </div>
              <div className="pointer-events-auto hidden shrink-0 md:block">
                <ConditionsBadge conditions={routed.conditions} />
              </div>
            </div>

            {(stale || loading) && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 flex justify-center">
                <span className="rounded-full bg-slate-900/85 px-4 py-2 text-xs font-medium text-white shadow-lg backdrop-blur">
                  {loading ? "Recalculating route…" : "Press “Find Best Route” to update"}
                </span>
              </div>
            )}

            <div className="absolute right-3 bottom-3 hidden md:block">
              <MapLegend />
            </div>
          </div>
          <div className="border-t border-slate-200 bg-white px-4 py-3">
            <RouteLab conditions={conditions} onChange={changeConditions} />
          </div>
        </section>
      </main>
    </div>
  );
}
