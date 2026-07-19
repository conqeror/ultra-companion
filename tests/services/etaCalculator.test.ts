import { describe, expect, it, vi } from "vitest";
import {
  computeCachedRouteETA,
  computeCachedRouteTotalETA,
  computeCachedRouteTotalETAInChunks,
  computeRouteETA,
  computeRouteTotalETA,
  computeRouteTotalETAInChunks,
  getCachedRouteTotalETA,
  getETABetweenIndices,
  getETAToDistance,
  getETAToDistanceFromDistance,
  getTimeAtDistance,
} from "@/services/etaCalculator";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { computeSegmentTime } from "@/services/powerModel";
import type { FerryCrossing, RoutePoint } from "@/types";

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

const ferryCrossing = (overrides: Partial<FerryCrossing> = {}): FerryCrossing => ({
  id: "ferry-1",
  routeId: "r1",
  name: "Test ferry",
  startDistanceMeters: 1_000,
  endDistanceMeters: 3_000,
  startLatitude: 0,
  startLongitude: 0,
  endLatitude: 0,
  endLongitude: 0,
  durationMinutes: 5,
  assumedWaitMinutes: 3,
  boardingBufferMinutes: 2,
  source: "manual",
  sourceId: null,
  sourceUrl: null,
  operator: null,
  timetableUrl: null,
  bicycleAccess: "unknown",
  providerRefs: {},
  tags: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
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

  it("does not let a short adjacent elevation spike dominate ETA", () => {
    const points = [basePoint(0, 100, 0), basePoint(10, 106, 1), basePoint(200, 100, 2)];

    const cumulative = computeRouteETA(points, DEFAULT_POWER_CONFIG);
    const firstSegmentSeconds = cumulative[1] - cumulative[0];
    const flatSegmentSeconds = computeSegmentTime(10, 0, DEFAULT_POWER_CONFIG);

    expect(firstSegmentSeconds).toBeLessThan(flatSegmentSeconds * 2);
  });

  it("computeRouteTotalETA matches the final cumulative ETA without allocating lookup data", () => {
    const points = [
      basePoint(0, 100, 0),
      basePoint(500, 120, 1),
      basePoint(1_000, 110, 2),
      basePoint(1_500, null, 3),
    ];

    const cumulative = computeRouteETA(points, DEFAULT_POWER_CONFIG);

    expect(computeRouteTotalETA([], DEFAULT_POWER_CONFIG)).toBeNull();
    expect(computeRouteTotalETA([basePoint(0, 0, 0)], DEFAULT_POWER_CONFIG)).toBeNull();
    expect(computeRouteTotalETA(points, DEFAULT_POWER_CONFIG)).toBe(
      cumulative[cumulative.length - 1],
    );
  });

  it("computes total ETA in chunks while yielding between chunks", async () => {
    const points = [
      basePoint(0, 0, 0),
      basePoint(1_000, 10, 1),
      basePoint(2_000, 20, 2),
      basePoint(3_000, 10, 3),
      basePoint(4_000, 0, 4),
    ];
    const yieldControl = vi.fn(async () => {});

    await expect(
      computeRouteTotalETAInChunks(points, DEFAULT_POWER_CONFIG, {
        chunkPoints: 2,
        yieldControl,
      }),
    ).resolves.toBe(computeRouteTotalETA(points, DEFAULT_POWER_CONFIG));
    expect(yieldControl).toHaveBeenCalledTimes(1);
  });

  it("cancels obsolete chunked total ETA work", async () => {
    const points = [
      basePoint(0, 0, 0),
      basePoint(1_000, 10, 1),
      basePoint(2_000, 20, 2),
      basePoint(3_000, 10, 3),
      basePoint(4_000, 0, 4),
    ];
    let cancelled = false;

    await expect(
      computeRouteTotalETAInChunks(points, DEFAULT_POWER_CONFIG, {
        chunkPoints: 2,
        shouldCancel: () => cancelled,
        yieldControl: async () => {
          cancelled = true;
        },
      }),
    ).resolves.toBeNull();
  });

  it("caches completed chunked totals across equivalent point arrays", async () => {
    const points = [
      basePoint(0, 0, 0),
      basePoint(1_000, 10, 1),
      basePoint(2_000, 20, 2),
      basePoint(3_000, 10, 3),
      basePoint(4_000, 0, 4),
    ];
    const firstYield = vi.fn(async () => {});
    const cachedYield = vi.fn(async () => {});

    const first = await computeCachedRouteTotalETAInChunks(
      "chunked-cache-complete",
      points,
      DEFAULT_POWER_CONFIG,
      { chunkPoints: 2, yieldControl: firstYield },
    );
    const cached = await computeCachedRouteTotalETAInChunks(
      "chunked-cache-complete",
      points.map((point) => ({ ...point })),
      DEFAULT_POWER_CONFIG,
      { chunkPoints: 2, yieldControl: cachedYield },
    );

    expect(first).toBe(computeRouteTotalETA(points, DEFAULT_POWER_CONFIG));
    expect(cached).toBe(first);
    expect(firstYield).toHaveBeenCalled();
    expect(cachedYield).not.toHaveBeenCalled();
  });

  it("does not cache a cancelled chunked total", async () => {
    const points = [
      basePoint(0, 0, 0),
      basePoint(1_000, 10, 1),
      basePoint(2_000, 20, 2),
      basePoint(3_000, 10, 3),
      basePoint(4_000, 0, 4),
    ];
    let cancelled = false;
    const retryYield = vi.fn(async () => {});

    await expect(
      computeCachedRouteTotalETAInChunks("chunked-cache-cancelled", points, DEFAULT_POWER_CONFIG, {
        chunkPoints: 2,
        shouldCancel: () => cancelled,
        yieldControl: async () => {
          cancelled = true;
        },
      }),
    ).resolves.toBeNull();

    await expect(
      computeCachedRouteTotalETAInChunks("chunked-cache-cancelled", points, DEFAULT_POWER_CONFIG, {
        chunkPoints: 2,
        yieldControl: retryYield,
      }),
    ).resolves.toBe(computeRouteTotalETA(points, DEFAULT_POWER_CONFIG));
    expect(retryYield).toHaveBeenCalled();
  });

  it("caches ETA arrays by route key, point fingerprint, and power config", () => {
    const points = [basePoint(0, 100, 0), basePoint(500, 120, 1), basePoint(1_000, 110, 2)];
    const equivalent = points.map((p) => ({ ...p }));
    const higherPower = {
      ...DEFAULT_POWER_CONFIG,
      powerWatts: DEFAULT_POWER_CONFIG.powerWatts + 20,
    };

    expect(computeCachedRouteETA("r1", points, DEFAULT_POWER_CONFIG)).toBe(
      computeCachedRouteETA("r1", equivalent, DEFAULT_POWER_CONFIG),
    );
    expect(computeCachedRouteETA("r1", points, DEFAULT_POWER_CONFIG)).not.toBe(
      computeCachedRouteETA("r1", points, higherPower),
    );
  });

  it("caches total ETA by route key while preserving computed values", () => {
    const points = [basePoint(0, 100, 0), basePoint(500, 120, 1), basePoint(1_000, 110, 2)];

    expect(computeCachedRouteTotalETA("variant-a", points, DEFAULT_POWER_CONFIG)).toBe(
      computeRouteTotalETA(points, DEFAULT_POWER_CONFIG),
    );
    expect(computeCachedRouteTotalETA("variant-a", points, DEFAULT_POWER_CONFIG)).toBe(
      computeCachedRouteTotalETA(
        "variant-a",
        points.map((p) => Object.assign({}, p)),
        DEFAULT_POWER_CONFIG,
      ),
    );
  });

  it("reads a completed total ETA without starting another calculation", async () => {
    const points = [basePoint(0, 100, 0), basePoint(500, 120, 1), basePoint(1_000, 110, 2)];

    expect(getCachedRouteTotalETA("segment-read", points, DEFAULT_POWER_CONFIG)).toBeUndefined();

    const computed = await computeCachedRouteTotalETAInChunks(
      "segment-read",
      points,
      DEFAULT_POWER_CONFIG,
    );

    expect(
      getCachedRouteTotalETA(
        "segment-read",
        points.map((point) => Object.assign({}, point)),
        DEFAULT_POWER_CONFIG,
      ),
    ).toBe(computed);
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

  it("getETAToDistanceFromDistance uses projected route progress as the start", () => {
    const points = [basePoint(0, 100, 0), basePoint(1_000, 100, 1), basePoint(2_000, 100, 2)];
    const cumulative = [0, 100, 200];

    const result = getETAToDistanceFromDistance(cumulative, points, 250, 1_500);

    expect(result?.distanceMeters).toBe(1_250);
    expect(result?.ridingTimeSeconds).toBe(125);
  });

  it("excludes ferry kilometres and cycling time from route ETA", () => {
    const points = [
      basePoint(0, 100, 0),
      basePoint(1_000, 100, 1),
      basePoint(2_000, 100, 2),
      basePoint(3_000, 100, 3),
      basePoint(4_000, 100, 4),
    ];
    const ferry = ferryCrossing({
      durationMinutes: 0,
      assumedWaitMinutes: 0,
      boardingBufferMinutes: 0,
    });
    const roadSegmentSeconds = computeSegmentTime(1_000, 0, DEFAULT_POWER_CONFIG);

    const cumulative = computeRouteETA(points, DEFAULT_POWER_CONFIG, [ferry]);
    const routeETA = getETAToDistanceFromDistance(cumulative, points, 0, 4_000, [ferry]);

    expect(cumulative.at(-1)).toBeCloseTo(roadSegmentSeconds * 2);
    expect(routeETA?.distanceMeters).toBe(2_000);
    expect(routeETA?.ridingTimeSeconds).toBeCloseTo(roadSegmentSeconds * 2);
  });

  it("charges ferry delay exactly once when the landing is reached", () => {
    const points = [
      basePoint(0, 100, 0),
      basePoint(1_000, 100, 1),
      basePoint(2_000, 100, 2),
      basePoint(3_000, 100, 3),
      basePoint(4_000, 100, 4),
    ];
    const ferry = ferryCrossing();
    const roadSegmentSeconds = computeSegmentTime(1_000, 0, DEFAULT_POWER_CONFIG);
    const ferryDelaySeconds = 10 * 60;

    const cumulative = computeRouteETA(points, DEFAULT_POWER_CONFIG, [ferry]);

    expect(cumulative[1]).toBeCloseTo(roadSegmentSeconds);
    expect(cumulative[2]).toBeCloseTo(roadSegmentSeconds);
    expect(cumulative[3]).toBeCloseTo(roadSegmentSeconds + ferryDelaySeconds);
    expect(cumulative[4]).toBeCloseTo(roadSegmentSeconds * 2 + ferryDelaySeconds);
    expect(cumulative[3] - cumulative[2]).toBeCloseTo(ferryDelaySeconds);
    expect(cumulative[4] - cumulative[3]).toBeCloseTo(roadSegmentSeconds);
  });

  it("interpolates a ferry delay discretely at a landing between raw points", () => {
    const points = [basePoint(0, 100, 0), basePoint(20_000, 100, 1)];
    const ferry = ferryCrossing({
      startDistanceMeters: 10_000,
      endDistanceMeters: 12_000,
      durationMinutes: 10,
      assumedWaitMinutes: 0,
      boardingBufferMinutes: 0,
    });
    // 18 km of road at 60 s/km plus the 10-minute ferry delay.
    const cumulative = [0, 1_680];

    expect(getTimeAtDistance(cumulative, points, 11_999, [ferry])).toBeCloseTo(600);
    expect(getTimeAtDistance(cumulative, points, 12_000, [ferry])).toBeCloseTo(1_200);
    expect(getTimeAtDistance(cumulative, points, 13_000, [ferry])).toBeCloseTo(1_260);
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
