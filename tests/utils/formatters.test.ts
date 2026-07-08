import { describe, expect, it } from "vitest";
import {
  formatDayAwareETAMarkerLabel,
  formatUpcomingDayHeaderLabel,
  localCalendarDayOrdinal,
} from "@/utils/formatters";

describe("date-aware formatters", () => {
  const base = new Date(2026, 6, 8, 8, 0, 0);

  it("keeps same-day ETA marker labels compact", () => {
    const eta = new Date(2026, 6, 8, 16, 0, 0);

    expect(localCalendarDayOrdinal(eta, base.getTime())).toBe(1);
    expect(formatDayAwareETAMarkerLabel(eta, base.getTime())).toBe("16:00");
  });

  it("prefixes tomorrow ETA marker labels with day 2", () => {
    const eta = new Date(2026, 6, 9, 16, 0, 0);

    expect(localCalendarDayOrdinal(eta, base.getTime())).toBe(2);
    expect(formatDayAwareETAMarkerLabel(eta, base.getTime())).toBe("2/16:00");
  });

  it("prefixes later ETA marker labels with their race day ordinal", () => {
    const eta = new Date(2026, 6, 10, 16, 0, 0);

    expect(formatDayAwareETAMarkerLabel(eta, base.getTime())).toBe("3/16:00");
  });

  it("uses local calendar days when crossing midnight", () => {
    const lateBase = new Date(2026, 6, 8, 23, 50, 0);
    const afterMidnight = new Date(2026, 6, 9, 0, 10, 0);

    expect(localCalendarDayOrdinal(afterMidnight, lateBase.getTime())).toBe(2);
    expect(formatDayAwareETAMarkerLabel(afterMidnight, lateBase.getTime())).toBe("2/00:10");
  });

  it("formats upcoming day headers with relative day context", () => {
    expect(formatUpcomingDayHeaderLabel(new Date(2026, 6, 8, 16, 0, 0), base.getTime())).toBe(
      "Day 1 · Today · Wed Jul 8",
    );
    expect(formatUpcomingDayHeaderLabel(new Date(2026, 6, 9, 16, 0, 0), base.getTime())).toBe(
      "Day 2 · Tomorrow · Thu Jul 9",
    );
    expect(formatUpcomingDayHeaderLabel(new Date(2026, 6, 10, 16, 0, 0), base.getTime())).toBe(
      "Day 3 · Fri Jul 10",
    );
  });

  it("uses the provided planned-start base date instead of current time", () => {
    const plannedStart = new Date(2026, 6, 12, 6, 0, 0);
    const eta = new Date(2026, 6, 13, 16, 0, 0);

    expect(formatDayAwareETAMarkerLabel(eta, plannedStart.getTime())).toBe("2/16:00");
    expect(formatUpcomingDayHeaderLabel(eta, plannedStart.getTime())).toBe(
      "Day 2 · Tomorrow · Mon Jul 13",
    );
  });
});
