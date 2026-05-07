import { describe, expect, it } from "vitest";
import {
  toDisplayClimb,
  toDisplayClimbForSpan,
  toDisplayDistanceMeters,
  toDisplayPOI,
  toDisplayPOIForSegments,
} from "@/services/displayDistance";
import type { Climb, POI, StitchedSegmentInfo } from "@/types";

const poi = (distanceAlongRouteMeters: number): POI => ({
  id: "poi-1",
  sourceId: "poi-1",
  source: "osm",
  name: "Water",
  category: "water",
  latitude: 0,
  longitude: 0,
  tags: {},
  distanceFromRouteMeters: 10,
  distanceAlongRouteMeters,
  routeId: "route-1",
});

const climb = (startDistanceMeters: number, endDistanceMeters: number): Climb => ({
  id: "climb-1",
  routeId: "route-1",
  name: "Climb",
  startDistanceMeters,
  endDistanceMeters,
  lengthMeters: endDistanceMeters - startDistanceMeters,
  totalAscentMeters: 150,
  startElevationMeters: 200,
  endElevationMeters: 350,
  averageGradientPercent: 5,
  maxGradientPercent: 9,
  difficultyScore: 120,
});

const segment = (routeId: string, distanceOffsetMeters: number): StitchedSegmentInfo => ({
  routeId,
  routeName: routeId,
  position: 0,
  variantKind: "full",
  baseRouteId: null,
  replaceStartDistanceMeters: null,
  replaceEndDistanceMeters: null,
  startPointIndex: 0,
  endPointIndex: 1,
  distanceOffsetMeters,
  segmentDistanceMeters: 1_000,
  segmentAscentMeters: 10,
  segmentDescentMeters: 10,
  sourceSpans: [
    {
      routeId,
      routeName: routeId,
      position: 0,
      kind: "full",
      startPointIndex: 0,
      endPointIndex: 1,
      rawStartDistanceMeters: 0,
      rawEndDistanceMeters: 1_000,
      effectiveStartDistanceMeters: toDisplayDistanceMeters(distanceOffsetMeters),
      effectiveEndDistanceMeters: toDisplayDistanceMeters(distanceOffsetMeters + 1_000),
      distanceOffsetMeters,
    },
  ],
});

describe("displayDistance", () => {
  it("adds POI effective distance without mutating the raw route distance", () => {
    const displayed = toDisplayPOI(poi(50), 1_000);

    expect(displayed.distanceAlongRouteMeters).toBe(50);
    expect(displayed.effectiveDistanceMeters).toBe(1_050);
  });

  it("adds climb effective bounds without mutating raw route distances", () => {
    const displayed = toDisplayClimb(climb(100, 600), 2_000);

    expect(displayed.startDistanceMeters).toBe(100);
    expect(displayed.endDistanceMeters).toBe(600);
    expect(displayed.effectiveDistanceMeters).toBe(2_100);
    expect(displayed.effectiveStartDistanceMeters).toBe(2_100);
    expect(displayed.effectiveEndDistanceMeters).toBe(2_600);
  });

  it("recomputes POI display distance from the current segment offset", () => {
    const stale = toDisplayPOI(poi(50), 1_000);
    const displayed = toDisplayPOIForSegments(stale, [segment("route-1", 2_000)]);

    expect(displayed?.distanceAlongRouteMeters).toBe(50);
    expect(displayed?.effectiveDistanceMeters).toBe(2_050);
  });

  it("returns null for a POI outside the current stitched segments", () => {
    const displayed = toDisplayPOIForSegments(poi(50), [segment("other-route", 1_000)]);

    expect(displayed).toBeNull();
  });

  it("recomputes clipped climb metrics for a source span", () => {
    const displayed = toDisplayClimbForSpan(
      {
        ...climb(100, 1_100),
        totalAscentMeters: 100,
        averageGradientPercent: 10,
        difficultyScore: 200,
      },
      segment("route-1", 2_000).sourceSpans[0],
    );

    expect(displayed?.startDistanceMeters).toBe(100);
    expect(displayed?.endDistanceMeters).toBe(1_000);
    expect(displayed?.lengthMeters).toBe(900);
    expect(displayed?.totalAscentMeters).toBe(90);
    expect(displayed?.averageGradientPercent).toBe(10);
    expect(displayed?.difficultyScore).toBe(180);
    expect(displayed?.effectiveStartDistanceMeters).toBe(2_100);
    expect(displayed?.effectiveEndDistanceMeters).toBe(3_000);
  });
});
