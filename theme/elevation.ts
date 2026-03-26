/** Elevation gradient stops — single source of truth for chart coloring and legend. */
export const ELEVATION_STOPS = [
  { threshold: 2, color: "#22C55E", label: "0%" },
  { threshold: 4, color: "#EAB308", label: "2%" },
  { threshold: 6, color: "#F59E0B", label: "4%" },
  { threshold: 8, color: "#F97316", label: "6%" },
  { threshold: 10, color: "#EF4444", label: "8%" },
  { threshold: 13, color: "#DC2626", label: "10%" },
  { threshold: 17, color: "#991B1B", label: "13%" },
  { threshold: Infinity, color: "#7F1D1D", label: "17%+" },
] as const;

/** Returns the gradient color for a given slope percentage. Downhills are always green. */
export function gradientColor(gradientPercent: number): string {
  if (gradientPercent <= 0) return ELEVATION_STOPS[0].color;
  for (const stop of ELEVATION_STOPS) {
    if (gradientPercent < stop.threshold) return stop.color;
  }
  return ELEVATION_STOPS[ELEVATION_STOPS.length - 1].color;
}
