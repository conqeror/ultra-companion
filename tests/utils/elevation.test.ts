import { describe, expect, it } from "vitest";
import {
  computeTrustedElevationTotals,
  computeWindowedGradient,
  processRouteElevations,
} from "@/utils/elevation";
import type { RoutePoint } from "@/types";

function point(
  idx: number,
  distanceFromStartMeters: number,
  elevationMeters: number | null,
): RoutePoint {
  return {
    latitude: 0,
    longitude: distanceFromStartMeters / 100_000,
    elevationMeters,
    distanceFromStartMeters,
    idx,
  };
}

function rawPositiveAscent(points: RoutePoint[]): number {
  let ascent = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1].elevationMeters;
    const curr = points[i].elevationMeters;
    if (prev == null || curr == null) continue;
    const diff = curr - prev;
    if (diff > 0) ascent += diff;
  }
  return ascent;
}

describe("elevation utilities", () => {
  it("keeps route geometry while suppressing repeated elevation oscillations", () => {
    const points = Array.from({ length: 101 }, (_, idx) =>
      point(idx, idx * 20, 100 + idx * 2 + (idx % 2 === 0 ? -4 : 4)),
    );
    const rawAscent = rawPositiveAscent(points);

    const processed = processRouteElevations(points);

    expect(processed.points).toHaveLength(points.length);
    expect(processed.points[40].latitude).toBe(points[40].latitude);
    expect(processed.points[40].longitude).toBe(points[40].longitude);
    expect(processed.points[40].distanceFromStartMeters).toBe(points[40].distanceFromStartMeters);
    expect(processed.totalAscentMeters).toBeGreaterThan(170);
    expect(processed.totalAscentMeters).toBeLessThan(210);
    expect(processed.totalAscentMeters).toBeLessThan(rawAscent * 0.5);
  });

  it("fills missing elevation values before smoothing", () => {
    const processed = processRouteElevations([
      point(0, 0, 100),
      point(1, 100, null),
      point(2, 200, 200),
    ]);

    expect(processed.points.map((p) => p.elevationMeters)).toEqual([125, 150, 175]);
    expect(processed.totalAscentMeters).toBe(50);
  });

  it("ignores sub-threshold wobble when computing trusted totals", () => {
    const points = [100, 105, 100, 108, 100, 130].map((elevation, idx) =>
      point(idx, idx * 20, elevation),
    );

    expect(computeTrustedElevationTotals(points)).toEqual({ ascent: 30, descent: 0 });
    expect(computeTrustedElevationTotals(points, 0)).toEqual({ ascent: 43, descent: 13 });
  });

  it("uses a distance window for gradients instead of adjacent point spikes", () => {
    const points = [point(0, 0, 100), point(1, 10, 106), point(2, 200, 100)];

    const adjacentGradient = (points[1].elevationMeters! - points[0].elevationMeters!) / 10;
    const windowedGradient = computeWindowedGradient(points, 1);

    expect(adjacentGradient).toBe(0.6);
    expect(windowedGradient).toBeLessThan(0.04);
  });
});
