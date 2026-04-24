import { describe, expect, it } from "vitest";
import { toDisplayClimb, toDisplayPOI } from "@/services/displayDistance";
import type { Climb, POI } from "@/types";

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
});
