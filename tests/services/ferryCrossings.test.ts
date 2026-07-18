import { describe, expect, it } from "vitest";
import {
  computeRidingElevationTotals,
  ferryDelaySeconds,
  ferryElapsedSecondsBeforeDistance,
  ferryOverlapDistanceMeters,
  ferrySignature,
  filterClimbsOutsideFerries,
  geometricDistanceAtRidingDistance,
  mapFerryCrossingsToSourceSpans,
  normalizeFerrySpans,
  projectRoutePointsForRidingProfile,
  ridingDistanceAtGeometricDistance,
  ridingDistanceBetween,
  toDisplayFerryCrossing,
  totalRidingDistanceMeters,
  validateFerryCrossing,
} from "@/services/ferryCrossings";
import { toDisplayDistanceMeters } from "@/services/displayDistance";
import type { Climb, FerryCrossing, RoutePoint, StitchedSourceSpan } from "@/types";

function crossing(overrides: Partial<FerryCrossing> = {}): FerryCrossing {
  return {
    id: "ferry-1",
    routeId: "route-1",
    name: "Harbour ferry",
    startDistanceMeters: 200,
    endDistanceMeters: 400,
    startLatitude: 60,
    startLongitude: 5,
    endLatitude: 60.01,
    endLongitude: 5.01,
    durationMinutes: 20,
    assumedWaitMinutes: 15,
    boardingBufferMinutes: 5,
    source: "manual",
    sourceId: null,
    sourceUrl: null,
    operator: null,
    timetableUrl: null,
    bicycleAccess: "unknown",
    providerRefs: {},
    tags: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

function routePoint(
  idx: number,
  distanceFromStartMeters: number,
  elevationMeters: number | null = 100,
): RoutePoint {
  return {
    idx,
    distanceFromStartMeters,
    latitude: distanceFromStartMeters / 100_000,
    longitude: distanceFromStartMeters / 50_000,
    elevationMeters,
  };
}

function sourceSpan(overrides: Partial<StitchedSourceSpan> = {}): StitchedSourceSpan {
  return {
    routeId: "route-1",
    routeName: "Route 1",
    position: 0,
    kind: "full",
    startPointIndex: 0,
    endPointIndex: 10,
    rawStartDistanceMeters: 0,
    rawEndDistanceMeters: 1_000,
    effectiveStartDistanceMeters: toDisplayDistanceMeters(2_000),
    effectiveEndDistanceMeters: toDisplayDistanceMeters(3_000),
    distanceOffsetMeters: 2_000,
    ...overrides,
  };
}

function climb(id: string, startDistanceMeters: number, endDistanceMeters: number): Climb {
  return {
    id,
    routeId: "route-1",
    name: id,
    startDistanceMeters,
    endDistanceMeters,
    lengthMeters: endDistanceMeters - startDistanceMeters,
    totalAscentMeters: 100,
    startElevationMeters: 100,
    endElevationMeters: 200,
    averageGradientPercent: 5,
    maxGradientPercent: 10,
    difficultyScore: 50,
  };
}

describe("ferry crossing validation", () => {
  it("accepts a valid crossing inside the route", () => {
    expect(validateFerryCrossing(crossing(), 1_000)).toBeNull();
  });

  it.each([
    [{ name: "  " }, "Ferry name is required."],
    [{ startDistanceMeters: 400 }, "Landing must be after boarding on the route."],
    [{ endDistanceMeters: 1_001 }, "The ferry span is outside this route."],
    [{ assumedWaitMinutes: -1 }, "Ferry timing cannot be negative."],
    [{ startLatitude: 91 }, "Ferry terminal coordinates are invalid."],
    [{ endLongitude: -181 }, "Ferry terminal coordinates are invalid."],
    [
      { durationMinutes: Number.NaN },
      "Ferry coordinates, distances, and timing must be valid numbers.",
    ],
  ] satisfies Array<[Partial<FerryCrossing>, string]>)(
    "rejects invalid values %#",
    (overrides, message) => {
      expect(validateFerryCrossing(crossing(overrides), 1_000)).toBe(message);
    },
  );
});

describe("ferry distance transforms", () => {
  const spans = [
    { startDistanceMeters: 200, endDistanceMeters: 400 },
    { startDistanceMeters: 600, endDistanceMeters: 700 },
  ];

  it("normalizes, clamps, sorts, and merges overlapping spans", () => {
    expect(
      normalizeFerrySpans(
        [
          { startDistanceMeters: 600, endDistanceMeters: 800 },
          { startDistanceMeters: -50, endDistanceMeters: 100 },
          { startDistanceMeters: 799.995, endDistanceMeters: 900 },
          { startDistanceMeters: 950, endDistanceMeters: 1_200 },
          { startDistanceMeters: 300, endDistanceMeters: 300 },
          { startDistanceMeters: Number.NaN, endDistanceMeters: 0 },
        ],
        1_000,
      ),
    ).toEqual([
      { startDistanceMeters: 0, endDistanceMeters: 100 },
      { startDistanceMeters: 600, endDistanceMeters: 900 },
      { startDistanceMeters: 950, endDistanceMeters: 1_000 },
    ]);
  });

  it("excludes only the overlapping portion from riding distance", () => {
    expect(ferryOverlapDistanceMeters(100, 650, spans)).toBe(250);
    expect(ferryOverlapDistanceMeters(650, 100, spans)).toBe(250);
    expect(ridingDistanceAtGeometricDistance(300, spans)).toBe(200);
    expect(ridingDistanceAtGeometricDistance(650, spans)).toBe(400);
    expect(ridingDistanceBetween(100, 800, spans)).toBe(400);
    expect(totalRidingDistanceMeters(1_000, spans)).toBe(700);
  });

  it("inverts riding distance with explicit boarding and landing boundary semantics", () => {
    expect(geometricDistanceAtRidingDistance(100, 1_000, spans)).toBe(100);
    expect(geometricDistanceAtRidingDistance(200, 1_000, spans, "boarding")).toBe(200);
    expect(geometricDistanceAtRidingDistance(200, 1_000, spans, "landing")).toBe(400);
    expect(geometricDistanceAtRidingDistance(400, 1_000, spans, "boarding")).toBe(600);
    expect(geometricDistanceAtRidingDistance(400, 1_000, spans, "landing")).toBe(700);
    expect(geometricDistanceAtRidingDistance(450, 1_000, spans)).toBe(750);
    expect(geometricDistanceAtRidingDistance(99_999, 1_000, spans)).toBe(1_000);
  });
});

describe("ferry-aware elevation and profile projection", () => {
  it("counts ascent and descent only on road intervals", () => {
    const points = [100, 110, 120, 200, 50, 60, 80].map((elevation, idx) =>
      routePoint(idx, idx * 100, elevation),
    );

    expect(
      computeRidingElevationTotals(points, [{ startDistanceMeters: 200, endDistanceMeters: 400 }]),
    ).toEqual({ ascent: 50, descent: 0 });
    expect(
      computeRidingElevationTotals(
        points,
        [{ startDistanceMeters: 200, endDistanceMeters: 400 }],
        100,
        500,
      ),
    ).toEqual({ ascent: 20, descent: 0 });
  });

  it("compresses ferry geometry and inserts a null-elevation break at landing", () => {
    const points = [0, 100, 200, 300, 400, 500].map((distance, idx) =>
      routePoint(idx, distance, 100 + distance / 10),
    );

    const projected = projectRoutePointsForRidingProfile(points, [
      { startDistanceMeters: 150, endDistanceMeters: 350 },
    ]);

    expect(projected.map((point) => point.distanceFromStartMeters)).toEqual([
      0, 100, 150, 150, 200, 300,
    ]);
    expect(projected.map((point) => point.elevationMeters)).toEqual([
      100,
      110,
      115,
      null,
      140,
      150,
    ]);
    expect(projected.map((point) => point.idx)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("removes any climb that overlaps ferry water while retaining boundary-touching climbs", () => {
    const climbs = [
      climb("before", 100, 200),
      climb("overlap", 150, 250),
      climb("inside", 250, 350),
      climb("after", 400, 500),
    ];

    expect(
      filterClimbsOutsideFerries(climbs, [
        { startDistanceMeters: 200, endDistanceMeters: 400 },
      ]).map(({ id }) => id),
    ).toEqual(["before", "after"]);
  });
});

describe("ferry display mapping and timing", () => {
  it("maps raw ferry bounds into display space and refreshes endpoint coordinates", () => {
    const raw = crossing({ startDistanceMeters: 100, endDistanceMeters: 300 });
    const points = [routePoint(0, 0), routePoint(1, 200), routePoint(2, 400)];

    const displayed = toDisplayFerryCrossing(raw, 100, 300, 2_000, points);

    expect(displayed.startDistanceMeters).toBe(100);
    expect(displayed.endDistanceMeters).toBe(300);
    expect(displayed.effectiveStartDistanceMeters).toBe(2_100);
    expect(displayed.effectiveEndDistanceMeters).toBe(2_300);
    expect(displayed.startLatitude).toBeCloseTo(0.001);
    expect(displayed.endLongitude).toBeCloseTo(0.006);
    expect(raw.startLatitude).toBe(60);
  });

  it("maps only crossings fully contained in a source span and supports repeated route spans", () => {
    const contained = crossing({
      id: "contained",
      startDistanceMeters: 200,
      endDistanceMeters: 400,
    });
    const straddling = crossing({
      id: "straddling",
      startDistanceMeters: 450,
      endDistanceMeters: 650,
    });
    const spans = [
      sourceSpan({
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: 500,
        distanceOffsetMeters: 1_000,
      }),
      sourceSpan({
        position: 1,
        rawStartDistanceMeters: 700,
        rawEndDistanceMeters: 1_000,
        distanceOffsetMeters: 3_000,
      }),
      sourceSpan({
        position: 2,
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: 500,
        distanceOffsetMeters: 5_000,
      }),
    ];

    const mapped = mapFerryCrossingsToSourceSpans([straddling, contained], spans);

    expect(mapped).toHaveLength(2);
    expect(mapped.map((item) => item.id)).toEqual(["contained", "contained"]);
    expect(mapped.map((item) => item.effectiveStartDistanceMeters)).toEqual([1_200, 5_200]);
  });

  it("adds the complete delay only once the landing boundary is reached", () => {
    const first = crossing();
    const second = crossing({
      id: "ferry-2",
      startDistanceMeters: 600,
      endDistanceMeters: 700,
      durationMinutes: 10,
      assumedWaitMinutes: 0,
      boardingBufferMinutes: 0,
    });

    expect(ferryDelaySeconds(first)).toBe(40 * 60);
    expect(ferryElapsedSecondsBeforeDistance(399.98, [first, second])).toBe(0);
    expect(ferryElapsedSecondsBeforeDistance(400, [first, second])).toBe(40 * 60);
    expect(ferryElapsedSecondsBeforeDistance(1_000, [first, second])).toBe(50 * 60);
  });

  it("builds a stable signature independent of input ordering", () => {
    const first = crossing();
    const second = crossing({ id: "ferry-2", startDistanceMeters: 600, endDistanceMeters: 700 });

    expect(ferrySignature([second, first])).toBe(ferrySignature([first, second]));
    expect(ferrySignature([first])).not.toBe(
      ferrySignature([{ ...first, assumedWaitMinutes: first.assumedWaitMinutes + 1 }]),
    );
  });
});
