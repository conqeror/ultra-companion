import { describe, expect, it } from "vitest";
import {
  proposePatchVariantFromPoints,
  stitchCollection,
  stitchPOIs,
} from "@/services/stitchingService";
import { stitchCollectionFromData as stitchCollectionFromCore } from "@/services/stitchingCore";
import { toDisplayDistanceMeters } from "@/services/displayDistance";
import { databaseMocks } from "@/tests/mocks/database";
import type {
  CollectionSegment,
  POI,
  RoutePoint,
  RouteWithPoints,
  StitchedSegmentInfo,
} from "@/types";

const poi = (id: string, routeId: string, distanceAlongRouteMeters: number): POI => ({
  id,
  sourceId: id,
  source: "osm",
  name: id,
  category: "water",
  latitude: 0,
  longitude: 0,
  tags: {},
  distanceFromRouteMeters: 0,
  distanceAlongRouteMeters,
  routeId,
});

const route = (id: string, distanceOffset = 0): RouteWithPoints => ({
  id,
  name: id,
  fileName: `${id}.gpx`,
  color: "#fff",
  isActive: false,
  isVisible: true,
  totalDistanceMeters: 1_000,
  totalAscentMeters: 100,
  totalDescentMeters: 80,
  pointCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [
    {
      latitude: 0,
      longitude: 0,
      elevationMeters: 100,
      distanceFromStartMeters: distanceOffset,
      idx: 0,
    },
    {
      latitude: 0,
      longitude: 0.01,
      elevationMeters: 120,
      distanceFromStartMeters: distanceOffset + 1_000,
      idx: 1,
    },
  ],
});

const routeFromPoints = (id: string, points: RoutePoint[]): RouteWithPoints => ({
  id,
  name: id,
  fileName: `${id}.gpx`,
  color: "#fff",
  isActive: false,
  isVisible: true,
  totalDistanceMeters: points[points.length - 1]?.distanceFromStartMeters ?? 0,
  totalAscentMeters: 0,
  totalDescentMeters: 0,
  pointCount: points.length,
  createdAt: "2026-01-01T00:00:00.000Z",
  points,
});

const routePoint = (
  idx: number,
  distanceFromStartMeters: number,
  longitude: number,
): RoutePoint => ({
  latitude: 0,
  longitude,
  elevationMeters: 100,
  distanceFromStartMeters,
  idx,
});

const collectionSegment = (
  routeId: string,
  position: number,
  isSelected = true,
  patch?: {
    baseRouteId: string;
    replaceStartDistanceMeters: number;
    replaceEndDistanceMeters: number;
  },
): CollectionSegment => ({
  collectionId: "c1",
  routeId,
  position,
  isSelected,
  variantKind: patch ? "patch" : "full",
  baseRouteId: patch?.baseRouteId ?? null,
  replaceStartDistanceMeters: patch?.replaceStartDistanceMeters ?? null,
  replaceEndDistanceMeters: patch?.replaceEndDistanceMeters ?? null,
});

const segmentInfo = (
  routeId: string,
  position: number,
  distanceOffsetMeters: number,
): StitchedSegmentInfo => ({
  routeId,
  routeName: routeId,
  position,
  variantKind: "full",
  baseRouteId: null,
  replaceStartDistanceMeters: null,
  replaceEndDistanceMeters: null,
  startPointIndex: position * 2,
  endPointIndex: position * 2 + 1,
  distanceOffsetMeters,
  segmentDistanceMeters: 1_000,
  segmentAscentMeters: 10,
  segmentDescentMeters: 10,
  sourceSpans: [
    {
      routeId,
      routeName: routeId,
      position,
      kind: "full",
      startPointIndex: position * 2,
      endPointIndex: position * 2 + 1,
      rawStartDistanceMeters: 0,
      rawEndDistanceMeters: 1_000,
      effectiveStartDistanceMeters: toDisplayDistanceMeters(distanceOffsetMeters),
      effectiveEndDistanceMeters: toDisplayDistanceMeters(distanceOffsetMeters + 1_000),
      distanceOffsetMeters,
    },
  ],
});

describe("stitchingService", () => {
  it("stitches collections from in-memory route data", () => {
    const stitched = stitchCollectionFromCore(
      "c1",
      [collectionSegment("r2", 1), collectionSegment("r1", 0), collectionSegment("r3", 2, false)],
      {
        r1: route("r1"),
        r2: route("r2"),
      },
    );

    expect(stitched.segments.map((segment) => segment.routeId)).toEqual(["r1", "r2"]);
    expect(stitched.totalDistanceMeters).toBe(2_000);
    expect(stitched.points.map((point) => point.distanceFromStartMeters)).toEqual([
      0, 1_000, 1_000, 2_000,
    ]);
  });

  it("stitches selected segments in position order", async () => {
    databaseMocks.getCollectionSegments.mockResolvedValue([
      collectionSegment("r2", 1),
      collectionSegment("r1", 0),
      collectionSegment("r3", 2, false),
    ]);
    databaseMocks.getRouteWithPoints.mockImplementation(async (routeId: string) => {
      if (routeId === "r1") return route("r1");
      if (routeId === "r2") return route("r2");
      return null;
    });

    const stitched = await stitchCollection("c1");

    expect(stitched.segments).toHaveLength(2);
    expect(stitched.segments[0].routeId).toBe("r1");
    expect(stitched.segments[1].routeId).toBe("r2");
    expect(stitched.segments[0].distanceOffsetMeters).toBe(0);
    expect(stitched.segments[1].distanceOffsetMeters).toBe(1_000);
    expect(stitched.totalDistanceMeters).toBe(2_000);
    expect(stitched.totalAscentMeters).toBe(200);
    expect(stitched.points.map((point) => point.distanceFromStartMeters)).toEqual([
      0, 1_000, 1_000, 2_000,
    ]);
  });

  it("returns empty stitched collection when no selected routes exist", async () => {
    databaseMocks.getCollectionSegments.mockResolvedValue([collectionSegment("r1", 0, false)]);

    const stitched = await stitchCollection("c1");

    expect(stitched.points).toEqual([]);
    expect(stitched.segments).toEqual([]);
    expect(stitched.totalDistanceMeters).toBe(0);
    expect(stitched.totalAscentMeters).toBe(0);
    expect(stitched.totalDescentMeters).toBe(0);
    expect(stitched.pointsByRouteId).toEqual({});
  });

  it("can omit raw per-segment point arrays for active collection view models", async () => {
    databaseMocks.getCollectionSegments.mockResolvedValue([collectionSegment("r1", 0)]);
    databaseMocks.getRouteWithPoints.mockResolvedValue(route("r1"));

    const stitched = await stitchCollection("c1", { includePointsByRouteId: false });

    expect(stitched.points).toHaveLength(2);
    expect(stitched.pointsByRouteId).toEqual({});
  });

  it("stitchPOIs keeps raw distances and sorts by effective distances", () => {
    const segments = [segmentInfo("r1", 0, 0), segmentInfo("r2", 1, 1_000)];

    const combined = stitchPOIs(segments, {
      r1: [poi("a", "r1", 900)],
      r2: [poi("b", "r2", 10)],
      missing: [poi("c", "missing", 1)],
    });

    expect(combined.map((p) => p.id)).toEqual(["a", "b"]);
    expect(combined.map((p) => p.distanceAlongRouteMeters)).toEqual([900, 10]);
    expect(combined.map((p) => p.effectiveDistanceMeters)).toEqual([900, 1_010]);
  });

  it("stitchPOIs filters by stitched distance window before copying display POIs", () => {
    const segments = [segmentInfo("r1", 0, 0), segmentInfo("r2", 1, 1_000)];

    const combined = stitchPOIs(
      segments,
      {
        r1: [poi("behind", "r1", 100), poi("near", "r1", 900)],
        r2: [poi("ahead", "r2", 100), poi("far", "r2", 900)],
      },
      { startDistanceMeters: 800, endDistanceMeters: 1_200 },
    );

    expect(combined.map((p) => p.id)).toEqual(["near", "ahead"]);
    expect(combined.map((p) => p.effectiveDistanceMeters)).toEqual([900, 1_100]);
  });

  it("snaps patch variant endpoints onto the base route", () => {
    const basePoints = [
      routePoint(0, 0, 0),
      routePoint(1, 1_000, 0.01),
      routePoint(2, 2_000, 0.02),
    ];
    const patchPoints = [routePoint(0, 0, 0.004), routePoint(1, 700, 0.016)];

    const proposal = proposePatchVariantFromPoints("base", "patch", basePoints, patchPoints);

    expect(proposal?.replaceStartDistanceMeters).toBeCloseTo(400, 0);
    expect(proposal?.replaceEndDistanceMeters).toBeCloseTo(1_600, 0);
    expect(proposal?.isReversed).toBe(false);
  });

  it("flags reversed patch endpoint matches", () => {
    const basePoints = [
      routePoint(0, 0, 0),
      routePoint(1, 1_000, 0.01),
      routePoint(2, 2_000, 0.02),
    ];
    const patchPoints = [routePoint(0, 0, 0.016), routePoint(1, 700, 0.004)];

    const proposal = proposePatchVariantFromPoints("base", "patch", basePoints, patchPoints);

    expect(proposal?.replaceStartDistanceMeters).toBeCloseTo(400, 0);
    expect(proposal?.replaceEndDistanceMeters).toBeCloseTo(1_600, 0);
    expect(proposal?.isReversed).toBe(true);
  });

  it("stitches patch variants as base prefix, patch route, and base suffix", async () => {
    const base = routeFromPoints("base", [
      routePoint(0, 0, 0),
      routePoint(1, 500, 0.005),
      routePoint(2, 1_500, 0.015),
      routePoint(3, 2_000, 0.02),
    ]);
    const patch = routeFromPoints("patch", [routePoint(0, 0, 0.004), routePoint(1, 700, 0.016)]);

    databaseMocks.getCollectionSegments.mockResolvedValue([
      collectionSegment("base", 0, false),
      collectionSegment("patch", 0, true, {
        baseRouteId: "base",
        replaceStartDistanceMeters: 500,
        replaceEndDistanceMeters: 1_500,
      }),
    ]);
    databaseMocks.getRouteWithPoints.mockImplementation(async (routeId: string) => {
      if (routeId === "base") return base;
      if (routeId === "patch") return patch;
      return null;
    });

    const stitched = await stitchCollection("c1");

    expect(stitched.totalDistanceMeters).toBe(1_700);
    expect(stitched.segments[0].sourceSpans.map((span) => span.kind)).toEqual([
      "base-prefix",
      "patch",
      "base-suffix",
    ]);
    expect(stitched.points.map((pt) => pt.distanceFromStartMeters)).toEqual([
      0, 500, 500, 1_200, 1_200, 1_700,
    ]);
  });

  it("stitchPOIs clips base POIs inside a replaced patch range", async () => {
    const segment = segmentInfo("patch", 0, 0);
    segment.variantKind = "patch";
    segment.baseRouteId = "base";
    segment.replaceStartDistanceMeters = 500;
    segment.replaceEndDistanceMeters = 1_500;
    segment.segmentDistanceMeters = 1_700;
    segment.sourceSpans = [
      {
        routeId: "base",
        routeName: "base",
        position: 0,
        kind: "base-prefix",
        startPointIndex: 0,
        endPointIndex: 1,
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: 500,
        effectiveStartDistanceMeters: toDisplayDistanceMeters(0),
        effectiveEndDistanceMeters: toDisplayDistanceMeters(500),
        distanceOffsetMeters: 0,
      },
      {
        routeId: "patch",
        routeName: "patch",
        position: 0,
        kind: "patch",
        startPointIndex: 2,
        endPointIndex: 3,
        rawStartDistanceMeters: 0,
        rawEndDistanceMeters: 700,
        effectiveStartDistanceMeters: toDisplayDistanceMeters(500),
        effectiveEndDistanceMeters: toDisplayDistanceMeters(1_200),
        distanceOffsetMeters: 500,
      },
      {
        routeId: "base",
        routeName: "base",
        position: 0,
        kind: "base-suffix",
        startPointIndex: 4,
        endPointIndex: 5,
        rawStartDistanceMeters: 1_500,
        rawEndDistanceMeters: 2_000,
        effectiveStartDistanceMeters: toDisplayDistanceMeters(1_200),
        effectiveEndDistanceMeters: toDisplayDistanceMeters(1_700),
        distanceOffsetMeters: -300,
      },
    ];

    const combined = stitchPOIs([segment], {
      base: [
        poi("before", "base", 200),
        poi("replaced", "base", 1_000),
        poi("after", "base", 1_800),
      ],
      patch: [poi("patch-poi", "patch", 100)],
    });

    expect(combined.map((p) => p.id)).toEqual(["before", "patch-poi", "after"]);
    expect(combined.map((p) => p.effectiveDistanceMeters)).toEqual([200, 600, 1_500]);
  });
});
