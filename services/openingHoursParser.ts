import type { OpeningHoursStatus } from "@/types";
import { formatETA } from "@/utils/formatters";

const CLOSING_SOON_THRESHOLD_MS = 60 * 60 * 1000;

/**
 * A single opening period from Google Places API.
 * day: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 */
interface GooglePeriod {
  open: { day: number; hour: number; minute: number };
  close?: { day: number; hour: number; minute: number };
}

/** Convert day + hour + minute to minutes since start of week (Sunday 00:00) */
function toWeekMinutes(day: number, hour: number, minute: number): number {
  return day * 24 * 60 + hour * 60 + minute;
}

/** Convert a Date to minutes since start of week (Sunday 00:00) */
function dateToWeekMinutes(date: Date): number {
  return toWeekMinutes(date.getDay(), date.getHours(), date.getMinutes());
}

/** Convert week minutes back to a Date in the same week as refDate */
function weekMinutesToDate(weekMin: number, refDate: Date): Date {
  const refWeekMin = dateToWeekMinutes(refDate);
  let diffMin = weekMin - refWeekMin;
  // If the target is in the past this week, wrap to next week
  if (diffMin < 0) diffMin += 7 * 24 * 60;
  const result = new Date(refDate);
  result.setMinutes(refDate.getMinutes() + diffMin);
  result.setSeconds(0, 0);
  return result;
}

const WEEK_MINUTES = 7 * 24 * 60;

interface NormalizedPeriod {
  openMin: number; // minutes since Sunday 00:00
  closeMin: number; // minutes since Sunday 00:00 (may be > openMin by up to a week)
}

function normalizePeriods(periods: GooglePeriod[]): NormalizedPeriod[] {
  return periods.map((p) => {
    const openMin = toWeekMinutes(p.open.day, p.open.hour, p.open.minute);
    if (!p.close) {
      // No close = open 24h (entire week for a single-period 24/7 place)
      return { openMin, closeMin: openMin + WEEK_MINUTES };
    }
    let closeMin = toWeekMinutes(p.close.day, p.close.hour, p.close.minute);
    // Handle overnight / cross-week wrapping
    if (closeMin <= openMin) closeMin += WEEK_MINUTES;
    return { openMin, closeMin };
  });
}

function parsePeriods(tag: string): GooglePeriod[] | null {
  if (!tag || !tag.startsWith("[")) return null; // Skip OSM-format strings
  try {
    const parsed = JSON.parse(tag);
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    // Validate structure: each period must have open.day, open.hour, open.minute
    const first = parsed[0];
    if (!first?.open || typeof first.open.day !== "number") return null;
    return parsed as GooglePeriod[];
  } catch {
    return null;
  }
}

export function getOpeningHoursStatus(
  tag: string,
  referenceTime?: Date,
): OpeningHoursStatus | null {
  const periods = parsePeriods(tag);
  if (!periods) return null;

  const now = referenceTime ?? new Date();
  const nowMin = dateToWeekMinutes(now);
  const normalized = normalizePeriods(periods);

  // Check if currently open
  let currentPeriod: NormalizedPeriod | null = null;
  for (const np of normalized) {
    // Check both this week and wrap-around from previous week
    if (
      (nowMin >= np.openMin && nowMin < np.closeMin) ||
      (nowMin + WEEK_MINUTES >= np.openMin && nowMin + WEEK_MINUTES < np.closeMin)
    ) {
      currentPeriod = np;
      break;
    }
  }

  const isOpen = currentPeriod != null;

  let detail: string | null = null;
  let closingSoon = false;

  if (isOpen && currentPeriod) {
    // 24/7 check: single period spanning entire week
    if (currentPeriod.closeMin - currentPeriod.openMin >= WEEK_MINUTES) {
      return { isOpen: true, label: "Open", detail: "24/7", closingSoon: false };
    }
    const closeDate = weekMinutesToDate(currentPeriod.closeMin % WEEK_MINUTES, now);
    detail = `closes ${formatETA(closeDate)}`;
    const msUntilClose = closeDate.getTime() - now.getTime();
    closingSoon = msUntilClose > 0 && msUntilClose <= CLOSING_SOON_THRESHOLD_MS;
  } else {
    // Find next opening time
    let bestDiff = Infinity;
    let bestOpenMin = -1;
    for (const np of normalized) {
      let diff = np.openMin - nowMin;
      if (diff <= 0) diff += WEEK_MINUTES;
      if (diff < bestDiff) {
        bestDiff = diff;
        bestOpenMin = np.openMin;
      }
    }
    if (bestOpenMin >= 0) {
      const openDate = weekMinutesToDate(bestOpenMin % WEEK_MINUTES, now);
      detail = `opens ${formatETA(openDate)}`;
    }
  }

  return { isOpen, label: isOpen ? "Open" : "Closed", detail, closingSoon };
}

export interface DaySchedule {
  label: string;        // "Today", "Tomorrow", "Monday", etc.
  hours: string;        // "06:00–22:00", "06:00–14:00, 16:00–22:00", "Closed", "24h"
}

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Get opening hours schedule for today and tomorrow */
export function getDaySchedules(tag: string, referenceTime?: Date): DaySchedule[] | null {
  const periods = parsePeriods(tag);
  if (!periods) return null;

  // Check for 24/7
  const normalized = normalizePeriods(periods);
  if (normalized.length === 1 && normalized[0].closeMin - normalized[0].openMin >= WEEK_MINUTES) {
    return [
      { label: "Today", hours: "24h" },
      { label: "Tomorrow", hours: "24h" },
    ];
  }

  const now = referenceTime ?? new Date();
  const todayDay = now.getDay();
  const tomorrowDay = (todayDay + 1) % 7;

  return [
    { label: "Today", hours: formatDayHours(periods, todayDay) },
    { label: "Tomorrow", hours: formatDayHours(periods, tomorrowDay) },
  ];
}

function formatDayHours(periods: GooglePeriod[], day: number): string {
  // Collect all periods that apply to this day
  const ranges: string[] = [];

  for (const p of periods) {
    if (p.open.day !== day) continue;
    const open = `${pad2(p.open.hour)}:${pad2(p.open.minute)}`;
    if (!p.close) {
      ranges.push("24h");
    } else {
      const close = `${pad2(p.close.hour)}:${pad2(p.close.minute)}`;
      ranges.push(`${open}–${close}`);
    }
  }

  if (ranges.length === 0) return "Closed";
  return ranges.join(", ");
}

export function isOpenAt(tag: string, time: Date): boolean | null {
  const periods = parsePeriods(tag);
  if (!periods) return null;

  const timeMin = dateToWeekMinutes(time);
  const normalized = normalizePeriods(periods);

  for (const np of normalized) {
    if (
      (timeMin >= np.openMin && timeMin < np.closeMin) ||
      (timeMin + WEEK_MINUTES >= np.openMin && timeMin + WEEK_MINUTES < np.closeMin)
    ) {
      return true;
    }
  }
  return false;
}
