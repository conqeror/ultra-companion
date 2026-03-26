import type { UnitSystem } from "@/types";

export function formatDistance(meters: number, units: UnitSystem): string {
  if (units === "imperial") {
    const miles = meters / 1609.344;
    return miles < 1
      ? `${Math.round(meters * 3.28084)} ft`
      : `${miles.toFixed(1)} mi`;
  }
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(1)} km`;
}

export function formatElevation(meters: number, units: UnitSystem): string {
  if (units === "imperial") {
    return `${Math.round(meters * 3.28084)} ft`;
  }
  return `${Math.round(meters)} m`;
}
