import OpeningHours from "opening_hours";
import type { OpeningHoursStatus } from "@/types";
import { formatETA } from "@/utils/formatters";
const CLOSING_SOON_THRESHOLD_MS = 60 * 60 * 1000;

export function getOpeningHoursStatus(
  tag: string,
  referenceTime?: Date,
): OpeningHoursStatus | null {
  if (!tag) return null;
  if (tag.trim() === "24/7") {
    return { isOpen: true, label: "Open", detail: "24/7", closingSoon: false };
  }

  try {
    const oh = new OpeningHours(tag);
    const now = referenceTime ?? new Date();
    const isOpen = oh.getState(now);
    const nextChange: Date | undefined = oh.getNextChange(now);

    let detail: string | null = null;
    let closingSoon = false;

    if (nextChange) {
      const time = formatETA(nextChange);
      detail = isOpen ? `closes ${time}` : `opens ${time}`;

      if (isOpen) {
        const msUntilClose = nextChange.getTime() - now.getTime();
        closingSoon = msUntilClose <= CLOSING_SOON_THRESHOLD_MS;
      }
    }

    return { isOpen, label: isOpen ? "Open" : "Closed", detail, closingSoon };
  } catch {
    return null;
  }
}

export function isOpenAt(tag: string, time: Date): boolean | null {
  if (!tag) return null;
  if (tag.trim() === "24/7") return true;
  try {
    const oh = new OpeningHours(tag);
    return oh.getState(time);
  } catch {
    return null;
  }
}
