import { describe, expect, it } from "vitest";
import {
  applyPlannedStopOffsetToETA,
  departureTimeAfterPlannedStop,
  getPlannedStopDurationMinutes,
  plannedStopOffsetSecondsBeforeDistance,
  plannedStopsFromPOIs,
  setPlannedStopDurationTag,
} from "@/services/plannedStops";
import { toDisplayPOI } from "@/services/displayDistance";
import { buildPoi } from "@/tests/fixtures/poi";
import type { DisplayDistanceMeters } from "@/types";

describe("plannedStops", () => {
  it("parses positive integer stop durations from POI tags", () => {
    expect(getPlannedStopDurationMinutes({ planned_stop_duration_minutes: "15" })).toBe(15);
    expect(getPlannedStopDurationMinutes({ planned_stop_duration_minutes: "0" })).toBe(0);
    expect(getPlannedStopDurationMinutes({ planned_stop_duration_minutes: "-5" })).toBe(0);
    expect(getPlannedStopDurationMinutes({ planned_stop_duration_minutes: "12.5" })).toBe(0);
    expect(getPlannedStopDurationMinutes({ planned_stop_duration_minutes: "soon" })).toBe(0);
    expect(getPlannedStopDurationMinutes({})).toBe(0);
  });

  it("sets and clears planned stop tags", () => {
    expect(setPlannedStopDurationTag({ notes: "shop" }, 30)).toEqual({
      notes: "shop",
      planned_stop_duration_minutes: "30",
    });
    expect(
      setPlannedStopDurationTag({ notes: "shop", planned_stop_duration_minutes: "30" }, 0),
    ).toEqual({ notes: "shop" });
  });

  it("stores any positive stop duration as an integer-minute string", () => {
    for (const minutes of [5, 10, 15, 30, 45, 60, 73]) {
      expect(setPlannedStopDurationTag({}, minutes)).toEqual({
        planned_stop_duration_minutes: String(minutes),
      });
    }
  });

  it("builds planned stops from display-space POIs", () => {
    const stops = plannedStopsFromPOIs([
      toDisplayPOI(
        buildPoi("late", "route-1", 100, { tags: { planned_stop_duration_minutes: "10" } }),
        1_000,
      ),
      toDisplayPOI(buildPoi("none", "route-1", 200)),
    ]);

    expect(stops).toEqual([{ poiId: "late", distanceMeters: 1_100, durationSeconds: 600 }]);
  });

  it("sums only stops strictly after progress and before the target", () => {
    const stops = [
      { poiId: "behind", distanceMeters: 900 as DisplayDistanceMeters, durationSeconds: 300 },
      {
        poiId: "at-current",
        distanceMeters: 1_000 as DisplayDistanceMeters,
        durationSeconds: 300,
      },
      { poiId: "inside", distanceMeters: 1_500 as DisplayDistanceMeters, durationSeconds: 600 },
      { poiId: "at-target", distanceMeters: 2_000 as DisplayDistanceMeters, durationSeconds: 900 },
    ];

    expect(plannedStopOffsetSecondsBeforeDistance(stops, 1_000, 2_000)).toBe(600);
  });

  it("applies stop offsets to ETA clock and elapsed time", () => {
    const eta = {
      distanceMeters: 2_000,
      ridingTimeSeconds: 600,
      eta: new Date("2026-01-01T12:10:00.000Z"),
    };

    expect(applyPlannedStopOffsetToETA(eta, 300)?.eta.toISOString()).toBe(
      "2026-01-01T12:15:00.000Z",
    );
    expect(
      applyPlannedStopOffsetToETA(
        eta,
        300,
        new Date("2026-01-01T06:00:00.000Z").getTime(),
      )?.eta.toISOString(),
    ).toBe("2026-01-01T06:15:00.000Z");
  });

  it("derives departure time from arrival ETA and own stop duration", () => {
    expect(
      departureTimeAfterPlannedStop(
        {
          distanceMeters: 1_000,
          ridingTimeSeconds: 300,
          eta: new Date("2026-01-01T12:05:00.000Z"),
        },
        15,
      )?.toISOString(),
    ).toBe("2026-01-01T12:20:00.000Z");
  });
});
