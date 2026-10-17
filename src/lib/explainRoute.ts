import { formatDelta } from "./format";
import type { RouteCandidate, RouteMode } from "./mockRouting/types";

export interface RouteExplanation {
  headline: string;
  points: string[];
}

const reduction = (from: number, to: number) => (from > 0 ? (from - to) / from : 0);
const pct = (fraction: number) => Math.round(fraction * 100);

/** Turns the selected-vs-fastest numbers into the "Why this route?" copy. */
export function explainRoute(
  selected: RouteCandidate,
  fastest: RouteCandidate,
  mode: RouteMode,
  candidateCount: number,
): RouteExplanation {
  if (selected.id === fastest.id) {
    const points: string[] = [];
    if (selected.shadedShare !== undefined) points.push(`${pct(selected.shadedShare)}% of the walk is shaded`);
    if (selected.shelteredShare !== undefined && selected.shelteredShare > 0.15)
      points.push(`${pct(selected.shelteredShare)}% is covered or indoors`);
    const headline =
      mode === "fastest" || candidateCount === 1
        ? "The most direct way there — no detours needed."
        : "The quickest route is also the best fit right now — no alternative is worth the detour.";
    return { headline, points };
  }

  const sun = reduction(fastest.sunExposure, selected.sunExposure);
  const rain = reduction(fastest.rainExposure, selected.rainExposure);
  const effort = reduction(fastest.elevationEffort, selected.elevationEffort);

  const sunPhrase = `reduces sun exposure by ${pct(sun)}%`;
  const rainPhrase =
    selected.shelteredShare !== undefined
      ? `keeps ${pct(selected.shelteredShare)}% of your walk sheltered from rain`
      : `cuts rain exposure by ${pct(rain)}%`;
  const effortPhrase = `involves ${pct(effort)}% less climbing`;

  let lead: "sun" | "rain" | "effort" =
    mode === "cool" ? "sun" : mode === "dry" ? "rain" : sun >= rain && sun >= effort ? "sun" : rain >= effort ? "rain" : "effort";
  if (lead === "sun" && sun <= 0) lead = "rain";
  if (lead === "rain" && rain <= 0 && selected.shelteredShare === undefined) lead = "sun";

  const benefit = lead === "sun" ? sunPhrase : lead === "rain" ? rainPhrase : effortPhrase;
  const dt = selected.walkingTime - fastest.walkingTime;
  const headline =
    dt <= 15
      ? `Practically as fast as the quickest route, and ${benefit}.`
      : `Only ${formatDelta(dt)} longer than the fastest route, but ${benefit}.`;

  const points: string[] = [];
  if (lead !== "sun" && sun > 0.1) points.push(`Sun exposure down ${pct(sun)}% vs. the fastest route`);
  if (lead !== "rain" && rain > 0.1) points.push(`Rain exposure down ${pct(rain)}%`);
  if (lead === "rain" && fastest.shelteredShare !== undefined)
    points.push(`The fastest route is only ${pct(fastest.shelteredShare)}% sheltered`);
  if (lead !== "effort" && effort > 0.1) points.push(`${pct(effort)}% less climbing`);
  if (effort < -0.1) points.push("A little more uphill walking than the fastest option");

  return { headline, points };
}
