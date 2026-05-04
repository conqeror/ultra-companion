import { describe, expect, it } from "vitest";
import {
  createRidingHorizonWindow,
  filterClimbsToRidingHorizon,
  isDistanceInWindow,
  ridingHorizonKmLabelForMode,
  ridingHorizonLabelForMode,
  ridingHorizonMetersForMode,
  ridingHorizonScopeLabelForMode,
} from "@/utils/ridingHorizon";
import { toDisplayClimb } from "@/services/displayDistance";
import type { Climb, PanelMode } from "@/types";

const climb = (id: string, startDistanceMeters: number, endDistanceMeters: number): Climb => ({
  id,
  routeId: "route-1",
  name: id,
  startDistanceMeters,
  endDistanceMeters,
  lengthMeters: endDistanceMeters - startDistanceMeters,
  totalAscentMeters: 100,
  startElevationMeters: 200,
  endElevationMeters: 300,
  averageGradientPercent: 5,
  maxGradientPercent: 9,
  difficultyScore: 120,
});

describe("ridingHorizon", () => {
  it("maps panel modes to riding horizons", () => {
    const modes: PanelMode[] = [
      "upcoming-10",
      "upcoming-25",
      "upcoming-50",
      "upcoming-100",
      "upcoming-200",
      "full-route",
    ];

    expect(modes.map(ridingHorizonMetersForMode)).toEqual([
      10_000,
      25_000,
      50_000,
      100_000,
      200_000,
      null,
    ]);
    expect(modes.map(ridingHorizonKmLabelForMode)).toEqual([
      "10",
      "25",
      "50",
      "100",
      "200",
      "FULL",
    ]);
    expect(ridingHorizonLabelForMode("full-route")).toBe("FULL");
    expect(ridingHorizonScopeLabelForMode("full-route")).toBe("the full route");
  });

  it("anchors the horizon at snapped progress and preserves the behind buffer", () => {
    const window = createRidingHorizonWindow(12_000, 50_000, {
      behindMeters: 1_000,
      totalDistanceMeters: 55_000,
    });

    expect(window).toEqual({ startDistanceMeters: 11_000, endDistanceMeters: 55_000 });
    expect(isDistanceInWindow(10_999, window)).toBe(false);
    expect(isDistanceInWindow(11_000, window)).toBe(true);
    expect(isDistanceInWindow(55_000, window)).toBe(true);
    expect(isDistanceInWindow(55_001, window)).toBe(false);
  });

  it("falls back to a route-start horizon when the rider is not snapped", () => {
    expect(createRidingHorizonWindow(null, 25_000, { totalDistanceMeters: 80_000 })).toEqual({
      startDistanceMeters: 0,
      endDistanceMeters: 25_000,
    });
  });

  it("returns no distance window for full-route mode", () => {
    expect(createRidingHorizonWindow(12_000, null, { behindMeters: 1_000 })).toBeUndefined();
    expect(isDistanceInWindow(500_000, undefined)).toBe(true);
  });

  it("keeps climbs that overlap the horizon and drops distant climbs", () => {
    const window = createRidingHorizonWindow(10_000, 20_000);
    const climbs = [
      toDisplayClimb(climb("past", 8_000, 9_000)),
      toDisplayClimb(climb("current", 9_500, 10_500)),
      toDisplayClimb(climb("ahead", 29_000, 31_000)),
      toDisplayClimb(climb("far", 31_001, 33_000)),
    ];

    expect(filterClimbsToRidingHorizon(climbs, window).map((item) => item.id)).toEqual([
      "current",
      "ahead",
    ]);
  });
});
