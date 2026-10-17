import type { RouteMode, RouteStrategy } from "./mockRouting/types";

export interface ModeConfig {
  id: RouteMode;
  title: string;
  description: string;
  /** Full class strings so Tailwind can see them. */
  activeClass: string;
  iconClass: string;
}

export const MODES: ModeConfig[] = [
  {
    id: "fastest",
    title: "Fastest",
    description: "Get there as quickly as possible",
    activeClass: "border-orange-400 bg-orange-50 ring-orange-400/30",
    iconClass: "bg-orange-100 text-orange-600",
  },
  {
    id: "cool",
    title: "Stay Cool",
    description: "Prefer shade and reduce sun exposure",
    activeClass: "border-emerald-500 bg-emerald-50 ring-emerald-500/30",
    iconClass: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "dry",
    title: "Stay Dry",
    description: "Prefer covered and sheltered paths",
    activeClass: "border-indigo-500 bg-indigo-50 ring-indigo-500/30",
    iconClass: "bg-indigo-100 text-indigo-700",
  },
  {
    id: "comfortable",
    title: "Comfortable",
    description: "Balance time, weather and walking effort",
    activeClass: "border-sky-500 bg-sky-50 ring-sky-500/30",
    iconClass: "bg-sky-100 text-sky-700",
  },
];

export const MODE_BY_ID = Object.fromEntries(MODES.map((m) => [m.id, m])) as Record<RouteMode, ModeConfig>;

export const ROUTE_COLORS: Record<RouteStrategy, string> = {
  fast: "#f97316",
  shaded: "#059669",
  covered: "#6366f1",
};
