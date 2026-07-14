import { describe, expect, it } from "vitest";
import type { RoutePoint } from "@/types";
import {
  buildElevationProfileSamples,
  downsampleElevationExtrema,
  getElevationIntervalForSampleLimit,
  getElevationSampleBudget,
  getElevationSampleIndexRange,
  getElevationTileDistanceRange,
  getVisibleElevationTileRange,
  interpolateElevationAtDistance,
  sampleElevationProfileForPixels,
  sliceElevationSamples,
  type ElevationProfileSample,
} from "@/utils/elevationProfileSampling";

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

function sample(distanceMeters: number, elevationMeters: number): ElevationProfileSample {
  return { distanceMeters, elevationMeters };
}

describe("elevation profile sampling", () => {
  it("normalizes missing elevations, duplicate distances, and distance regressions", () => {
    const samples = buildElevationProfileSamples([
      point(0, 0, null),
      point(1, 100, 100),
      point(2, 100, 120),
      point(3, 50, 999),
      point(4, 200, null),
      point(5, 300, 180),
      point(6, 400, null),
    ]);

    expect(samples).toEqual([
      sample(0, 120),
      sample(100, 120),
      sample(200, 150),
      sample(300, 180),
      sample(400, 180),
    ]);
    expect(
      samples.every(({ distanceMeters, elevationMeters }) => {
        return Number.isFinite(distanceMeters) && Number.isFinite(elevationMeters);
      }),
    ).toBe(true);
  });

  it("uses a stable fallback for an all-null profile and ignores invalid distances", () => {
    const samples = buildElevationProfileSamples([
      point(0, Number.NaN, 500),
      point(1, 0, null),
      point(2, 100, Number.POSITIVE_INFINITY),
    ]);

    expect(samples).toEqual([sample(0, 0), sample(100, 0)]);
    expect(buildElevationProfileSamples([])).toEqual([]);
  });

  it("keeps first, last, and each bucket's extrema in distance order", () => {
    const samples = [0, 10, 50, -20, 5, 8, 80, -40, 9, 0].map((elevation, index) =>
      sample(index * 10, elevation),
    );

    const downsampled = downsampleElevationExtrema(samples, 6);

    expect(downsampled).toEqual([
      sample(0, 0),
      sample(20, 50),
      sample(30, -20),
      sample(60, 80),
      sample(70, -40),
      sample(90, 0),
    ]);
    expect(downsampled).toHaveLength(6);
  });

  it("uses distance buckets so uneven source density does not consume the viewport budget", () => {
    const denseOpening = Array.from({ length: 50 }, (_, index) => sample(index + 1, index % 2));
    const downsampled = downsampleElevationExtrema(
      [sample(0, 0), ...denseOpening, sample(700, 400), sample(800, -200), sample(1000, 0)],
      6,
    );

    expect(downsampled).toContainEqual(sample(700, 400));
    expect(downsampled).toContainEqual(sample(800, -200));
    expect(downsampled.length).toBeLessThanOrEqual(6);
  });

  it("retains the dominant interior excursion with a three-sample budget", () => {
    const downsampled = downsampleElevationExtrema(
      [sample(0, 100), sample(100, 105), sample(200, 300), sample(300, 110)],
      3,
    );

    expect(downsampled).toEqual([sample(0, 100), sample(200, 300), sample(300, 110)]);
    expect(() => downsampleElevationExtrema(downsampled, 1)).toThrow(RangeError);
  });

  it("bounds a 300k-point / 4,000km profile by output pixels without losing endpoints", () => {
    const routePointCount = 300_001;
    const points = Array.from({ length: routePointCount }, (_, index) => {
      const distance = (index / (routePointCount - 1)) * 4_000_000;
      return point(index, distance, 500 + Math.sin(index / 20) * 300);
    });

    const samples = sampleElevationProfileForPixels(points, { pixelWidth: 320 });

    expect(samples.length).toBeLessThanOrEqual(320);
    expect(samples[0].distanceMeters).toBe(0);
    expect(samples[samples.length - 1].distanceMeters).toBe(4_000_000);
    expect(
      samples.every((value, index) => {
        return index === 0 || value.distanceMeters > samples[index - 1].distanceMeters;
      }),
    ).toBe(true);
  });

  it("streams safely across null elevations, duplicates, and distance regressions", () => {
    const samples = sampleElevationProfileForPixels(
      [
        point(0, 0, null),
        point(1, 100, 100),
        point(2, 100, 120),
        point(3, 50, 999),
        point(4, 200, null),
        point(5, 300, 180),
        point(6, 400, null),
      ],
      { pixelWidth: 100 },
    );

    expect(samples).toEqual([sample(0, 120), sample(100, 120), sample(300, 180), sample(400, 180)]);
    expect(samples.length).toBeLessThanOrEqual(100);
  });

  it("derives a sample budget from pixel density and an explicit upper cap", () => {
    expect(getElevationSampleBudget(375)).toBe(375);
    expect(getElevationSampleBudget(375, 2, 500)).toBe(500);
    expect(getElevationSampleBudget(0)).toBe(2);
    expect(getElevationSampleBudget(Number.NaN, Number.NaN, 1)).toBe(2);
  });

  it("keeps interval sampling bounded for a 4,000km SVG fallback", () => {
    const interval = getElevationIntervalForSampleLimit(4_000_000, 1_200, 100);

    expect(interval).toBeCloseTo(4_000_000 / 1_198);
    expect(Math.ceil(4_000_000 / interval) + 1).toBeLessThanOrEqual(1_200);
    expect(getElevationIntervalForSampleLimit(Number.NaN, 1, 100)).toBe(100);
  });

  it("interpolates and slices exact viewport boundaries", () => {
    const samples = [sample(0, 100), sample(100, 200), sample(300, 100)];

    expect(interpolateElevationAtDistance(samples, -100)).toBe(100);
    expect(interpolateElevationAtDistance(samples, 50)).toBe(150);
    expect(interpolateElevationAtDistance(samples, 200)).toBe(150);
    expect(interpolateElevationAtDistance(samples, 500)).toBe(100);
    expect(interpolateElevationAtDistance([], 50, 42)).toBe(42);
    expect(sliceElevationSamples(samples, 50, 250)).toEqual([
      sample(50, 150),
      sample(100, 200),
      sample(250, 125),
    ]);
  });

  it("finds adjacent samples for tile-edge interpolation", () => {
    const samples = [0, 100, 200, 300, 400].map((distance) => sample(distance, distance));

    expect(getElevationSampleIndexRange(samples, 150, 250)).toEqual({
      startIndex: 1,
      endIndexExclusive: 4,
    });
    expect(getElevationSampleIndexRange(samples, 150, 250, false)).toEqual({
      startIndex: 2,
      endIndexExclusive: 3,
    });
    expect(getElevationSampleIndexRange(samples, 600, 700)).toEqual({
      startIndex: 4,
      endIndexExclusive: 5,
    });
  });

  it("returns viewport tiles with clamped overscan", () => {
    expect(
      getVisibleElevationTileRange({
        scrollOffsetPixels: 520,
        viewportWidthPixels: 390,
        tileWidthPixels: 512,
        contentWidthPixels: 3000,
        overscanTiles: 1,
      }),
    ).toEqual({ firstTileIndex: 0, lastTileIndex: 2 });

    expect(
      getVisibleElevationTileRange({
        scrollOffsetPixels: 2800,
        viewportWidthPixels: 390,
        tileWidthPixels: 512,
        contentWidthPixels: 3000,
        overscanTiles: 1,
      }),
    ).toEqual({ firstTileIndex: 4, lastTileIndex: 5 });
    expect(
      getVisibleElevationTileRange({
        scrollOffsetPixels: 0,
        viewportWidthPixels: 0,
        tileWidthPixels: 512,
        contentWidthPixels: 3000,
      }),
    ).toBeNull();
  });

  it("maps render tiles to clamped distance windows", () => {
    expect(
      getElevationTileDistanceRange({
        tileIndex: 2,
        tileWidthPixels: 512,
        pixelsPerMeter: 2,
        contentStartDistanceMeters: 1000,
        contentEndDistanceMeters: 2000,
      }),
    ).toEqual({ startDistanceMeters: 1512, endDistanceMeters: 1768 });
    expect(
      getElevationTileDistanceRange({
        tileIndex: 4,
        tileWidthPixels: 512,
        pixelsPerMeter: 2,
        contentStartDistanceMeters: 1000,
        contentEndDistanceMeters: 2000,
      }),
    ).toBeNull();
  });
});
