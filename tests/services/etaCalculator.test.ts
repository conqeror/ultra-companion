import { describe, expect, it, vi } from "vitest";
import { computeRouteETA, getETABetweenIndices, getETAToDistance } from "@/services/etaCalculator";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import type { RoutePoint } from "@/types";

const basePoint = (
  distanceFromStartMeters: number,
  elevationMeters: number | null,
  idx: number,
): RoutePoint => ({
  latitude: 0,
  longitude: 0,
  distanceFromStartMeters,
  elevationMeters,
  idx,
});

describe("etaCalculator", () => {
  it("computeRouteETA handles empty and single-point inputs", () => {
    expect(computeRouteETA([], DEFAULT_POWER_CONFIG)).toEqual([]);
    expect(computeRouteETA([basePoint(0, 0, 0)], DEFAULT_POWER_CONFIG)).toEqual([0]);
  });

  it("computeRouteETA is monotonic on mixed gradients", () => {
    const points = [
      basePoint(0, 100, 0),
      basePoint(500, 120, 1),
      basePoint(1_000, 110, 2),
      basePoint(1_500, null, 3),
    ];

    const cumulative = computeRouteETA(points, DEFAULT_POWER_CONFIG);

    expect(cumulative[0]).toBe(0);
    expect(cumulative[1]).toBeGreaterThanOrEqual(cumulative[0]);
    expect(cumulative[2]).toBeGreaterThanOrEqual(cumulative[1]);
    expect(cumulative[3]).toBeGreaterThanOrEqual(cumulative[2]);
    expect(Number.isFinite(cumulative[3])).toBe(true);
  });

  it("getETABetweenIndices returns 0 for invalid indexes and supports reverse subtraction", () => {
    const cumulative = [0, 60, 130];

    expect(getETABetweenIndices(cumulative, -1, 2)).toBe(0);
    expect(getETABetweenIndices(cumulative, 0, 10)).toBe(0);
    expect(getETABetweenIndices(cumulative, 2, 1)).toBe(-70);
  });

  it("getETAToDistance interpolates between points", () => {
    const points = [basePoint(0, 100, 0), basePoint(1_000, 100, 1), basePoint(2_000, 100, 2)];
    const cumulative = [0, 100, 200];

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const result = getETAToDistance(cumulative, points, 0, 1_500);

    expect(result).not.toBeNull();
    expect(result?.distanceMeters).toBe(1_500);
    expect(result?.ridingTimeSeconds).toBe(150);
    expect(result?.eta.toISOString()).toBe("2026-01-01T00:02:30.000Z");

    vi.useRealTimers();
  });

  it("getETAToDistance returns null for invalid cases and extrapolates after final point", () => {
    const points = [basePoint(0, 100, 0), basePoint(1_000, 100, 1)];
    const cumulative = [0, 120];

    expect(getETAToDistance(cumulative, points, 1, 500)).toBeNull();
    expect(getETAToDistance([], points, 0, 500)).toBeNull();
    expect(getETAToDistance(cumulative, [], 0, 500)).toBeNull();
    expect(getETAToDistance(cumulative, points, -1, 500)).toBeNull();

    const clamped = getETAToDistance(cumulative, points, 0, 5_000);
    expect(clamped?.ridingTimeSeconds).toBe(600);
    expect(clamped?.distanceMeters).toBe(5_000);
  });
});
