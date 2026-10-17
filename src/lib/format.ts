export function formatMinutes(seconds: number) {
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

export function formatClock(seconds: number) {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function formatDelta(seconds: number) {
  const total = Math.round(Math.abs(seconds));
  if (total < 60) return `${total} seconds`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

export function formatDistance(metres: number) {
  return metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
}

export function formatPercent(fraction: number) {
  return `${Math.round(fraction * 100)}%`;
}

export function effortLabel(effort: number) {
  if (effort < 0.34) return "Low";
  if (effort < 0.67) return "Moderate";
  return "High";
}
