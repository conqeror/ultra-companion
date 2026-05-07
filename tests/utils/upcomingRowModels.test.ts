import { describe, expect, it } from "vitest";
import { toDisplayClimb, toDisplayDistanceMeters, toDisplayPOI } from "@/services/displayDistance";
import { buildUpcomingTimeline, type UpcomingEvent } from "@/services/upcomingTimeline";
import { buildClimb } from "@/tests/fixtures/climb";
import { stitchedSegmentsFixture } from "@/tests/fixtures/collection";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import { buildUpcomingRowModels, getUpcomingRowItemType } from "@/utils/upcomingRowModels";

describe("upcomingRowModels", () => {
  it("builds stable item types and labels for mixed upcoming events", () => {
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("water", "r1", 700, { name: "Water tap" }))],
      starredPOIIds: new Set(["water"]),
      climbs: [toDisplayClimb(buildClimb("easy", "r1", 1_000, 1_300))],
      segments: stitchedSegmentsFixture,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
      routePoints: [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1), buildRoutePoint(2_000, 2)],
      cumulativeTime: [0, 100, 200],
    });

    const rows = buildUpcomingRowModels({
      events,
      currentDistanceMeters: 0,
      units: "metric",
    });

    expect(rows.map(getUpcomingRowItemType)).toEqual([
      "poi",
      "segment-transition",
      "climb-span",
      "finish",
    ]);
    expect(rows[0]).toMatchObject({
      title: "Water tap",
      distanceLabel: "700 m",
      distanceDirectionLabel: "ahead",
    });
    expect(rows[2].subtitle).toContain("+120 m");
  });

  it("keeps distance labels stable while progress remains inside a bucket", () => {
    const event: UpcomingEvent = {
      id: "poi:water",
      kind: "poi",
      distanceMeters: toDisplayDistanceMeters(1_500),
      eta: null,
      poi: toDisplayPOI(buildPoi("water", "r1", 1_500)),
    };

    const first = buildUpcomingRowModels({
      events: [event],
      currentDistanceMeters: bucketDistanceForDerivedWork(1_020),
      units: "metric",
    });
    const second = buildUpcomingRowModels({
      events: [event],
      currentDistanceMeters: bucketDistanceForDerivedWork(1_080),
      units: "metric",
    });
    const crossed = buildUpcomingRowModels({
      events: [event],
      currentDistanceMeters: bucketDistanceForDerivedWork(1_120),
      units: "metric",
    });

    expect(first[0].distanceLabel).toBe(second[0].distanceLabel);
    expect(crossed[0].distanceLabel).not.toBe(first[0].distanceLabel);
  });

  it("precomputes pressability and accessibility text", () => {
    const event: UpcomingEvent = {
      id: "finish",
      kind: "finish",
      distanceMeters: toDisplayDistanceMeters(2_000),
      eta: null,
      label: "Route finish",
    };

    const [row] = buildUpcomingRowModels({
      events: [event],
      currentDistanceMeters: 1_000,
      units: "metric",
    });

    expect(row.isPressable).toBe(false);
    expect(row.accessibilityLabel).toContain("Route finish");
    expect(row.accessibilityLabel).toContain("1.0 km ahead");
  });
});
