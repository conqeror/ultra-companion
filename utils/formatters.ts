import type { UnitSystem } from "@/types";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export function formatDistance(meters: number, units: UnitSystem): string {
  if (units === "imperial") {
    const miles = meters / 1609.344;
    return miles < 1 ? `${Math.round(meters * 3.28084)} ft` : `${miles.toFixed(1)} mi`;
  }
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}

export function formatElevation(meters: number, units: UnitSystem): string {
  if (units === "imperial") {
    return `${Math.round(meters * 3.28084)} ft`;
  }
  return `${Math.round(meters)} m`;
}

export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0m";
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

export function formatETA(date: Date): string {
  const h = date.getHours().toString().padStart(2, "0");
  const m = date.getMinutes().toString().padStart(2, "0");
  return h + ":" + m;
}

export function localCalendarDayOrdinal(date: Date, baseDateMs: number): number {
  if (Number.isNaN(date.getTime()) || Number.isNaN(baseDateMs)) return 1;

  const baseDate = new Date(baseDateMs);
  if (Number.isNaN(baseDate.getTime())) return 1;

  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const baseDay = Date.UTC(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
  return Math.max(1, Math.round((dateDay - baseDay) / MS_PER_DAY) + 1);
}

export function formatDayAwareETAMarkerLabel(date: Date, baseDateMs: number): string {
  const time = formatETA(date);
  const dayOrdinal = localCalendarDayOrdinal(date, baseDateMs);
  return dayOrdinal === 1 ? time : `${dayOrdinal}/${time}`;
}

export function formatUpcomingDayHeaderLabel(date: Date, baseDateMs: number): string {
  const dayOrdinal = localCalendarDayOrdinal(date, baseDateMs);
  const relativeLabel = dayOrdinal === 1 ? "Today" : dayOrdinal === 2 ? "Tomorrow" : null;
  const dateLabel = `${WEEKDAY_SHORT[date.getDay()]} ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
  return [`Day ${dayOrdinal}`, relativeLabel, dateLabel].filter(Boolean).join(" · ");
}

export function formatTimeDelta(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

export function formatTimeAgo(timestampMs: number): string {
  return `${formatTimeDelta(Date.now() - timestampMs)} ago`;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
