import { beforeEach, describe, expect, it, vi } from "vitest";
import { stitchCollection, stitchPOIs } from "@/services/stitchingService";
import type { POI, RouteWithPoints } from "@/types";

const { mockGetCollectionSegments, mockGetRouteWithPoints } = vi.hoisted(() => ({
  mockGetCollectionSegments: vi.fn(),
  mockGetRouteWithPoints: vi.fn(),
}));

vi.mock("@/db/database", () => ({
  getCollectionSegments: mockGetCollectionSegments,
  getRouteWithPoints: mockGetRouteWithPoints,
}));

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

describe("stitchingService", () => {
  beforeEach(() => {
    mockGetCollectionSegments.mockReset();
    mockGetRouteWithPoints.mockReset();
  });

  it("stitches selected segments in position order", async () => {
    mockGetCollectionSegments.mockResolvedValue([
      { collectionId: "c1", routeId: "r2", position: 1, isSelected: true },
      { collectionId: "c1", routeId: "r1", position: 0, isSelected: true },
      { collectionId: "c1", routeId: "r3", position: 2, isSelected: false },
    ]);
    mockGetRouteWithPoints.mockImplementation(async (routeId: string) => {
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
    mockGetCollectionSegments.mockResolvedValue([
      { collectionId: "c1", routeId: "r1", position: 0, isSelected: false },
    ]);

    const stitched = await stitchCollection("c1");

    expect(stitched.points).toEqual([]);
    expect(stitched.segments).toEqual([]);
    expect(stitched.totalDistanceMeters).toBe(0);
    expect(stitched.totalAscentMeters).toBe(0);
    expect(stitched.totalDescentMeters).toBe(0);
    expect(stitched.pointsByRouteId).toEqual({});
  });

  it("stitchPOIs keeps raw distances and sorts by effective distances", () => {
    const segments = [
      {
        routeId: "r1",
        routeName: "r1",
        position: 0,
        startPointIndex: 0,
        endPointIndex: 1,
        distanceOffsetMeters: 0,
        segmentDistanceMeters: 1_000,
        segmentAscentMeters: 10,
        segmentDescentMeters: 10,
      },
      {
        routeId: "r2",
        routeName: "r2",
        position: 1,
        startPointIndex: 2,
        endPointIndex: 3,
        distanceOffsetMeters: 1_000,
        segmentDistanceMeters: 1_000,
        segmentAscentMeters: 10,
        segmentDescentMeters: 10,
      },
    ];

    const combined = stitchPOIs(segments, {
      r1: [poi("a", "r1", 900)],
      r2: [poi("b", "r2", 10)],
      missing: [poi("c", "missing", 1)],
    });

    expect(combined.map((p) => p.id)).toEqual(["a", "b"]);
    expect(combined.map((p) => p.distanceAlongRouteMeters)).toEqual([900, 10]);
    expect(combined.map((p) => p.effectiveDistanceMeters)).toEqual([900, 1_010]);
  });
});
