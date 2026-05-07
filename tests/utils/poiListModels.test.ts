import { describe, expect, it } from "vitest";
import { toDisplayPOI } from "@/services/displayDistance";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { stitchedSegmentsFixture } from "@/tests/fixtures/collection";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import { createRidingHorizonWindow } from "@/utils/ridingHorizon";
import {
  buildPOIListRowModels,
  buildStarredPOIsForActiveRoute,
  buildVisiblePOIsForActiveRoute,
} from "@/utils/poiListModels";

const mondayNoon = new Date(2026, 0, 5, 12, 0, 0);
const mondayOpen = JSON.stringify([
  { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
]);
const mondayEveningOnly = JSON.stringify([
  { open: { day: 1, hour: 18, minute: 0 }, close: { day: 1, hour: 19, minute: 0 } },
]);

describe("poiListModels", () => {
  it("filters route-scoped POIs by category, search, and horizon", () => {
    const visible = buildVisiblePOIsForActiveRoute({
      routeIds: ["r1"],
      segments: null,
      poisByRoute: {
        r1: [
          buildPoi("tap", "r1", 1_000, {
            name: "Village Tap",
            tags: { opening_hours: mondayOpen },
          }),
          buildPoi("closed", "r1", 1_200, {
            name: "Closed Tap",
            tags: { opening_hours: mondayEveningOnly },
          }),
          buildPoi("food", "r1", 1_400, { category: "groceries" }),
          buildPoi("far", "r1", 5_000),
        ],
      },
      horizonWindow: createRidingHorizonWindow(0, 2_000),
      enabledCategories: ["water"],
      starredPOIIds: new Set(),
    });

    const rows = buildPOIListRowModels({
      pois: visible,
      currentDistanceMeters: 0,
      routePoints: [buildRoutePoint(0, 0), buildRoutePoint(2_000, 1)],
      cumulativeTime: [0, 200],
      starredPOIIds: new Set(),
      units: "metric",
      searchQuery: "village",
      etaStartTimeMs: mondayNoon.getTime(),
      referenceTime: mondayNoon,
    });

    expect(rows.map((row) => row.id)).toEqual(["tap"]);
    expect(rows[0]).toMatchObject({
      title: "Village Tap",
      distanceText: "1.0 km",
      etaOpeningText: "Open @ ETA",
    });
  });

  it("keeps starred POIs visible when category filters would hide them", () => {
    const visible = buildVisiblePOIsForActiveRoute({
      routeIds: ["r1"],
      segments: null,
      poisByRoute: {
        r1: [
          buildPoi("closed-star", "r1", 1_000, {
            category: "groceries",
            tags: { opening_hours: mondayEveningOnly },
          }),
        ],
      },
      enabledCategories: ["water"],
      starredPOIIds: new Set(["closed-star"]),
    });

    expect(visible.map((poi) => poi.id)).toEqual(["closed-star"]);
  });

  it("keeps stitched collection POIs at their effective distances", () => {
    const visible = buildVisiblePOIsForActiveRoute({
      routeIds: ["r1", "r2"],
      segments: stitchedSegmentsFixture,
      poisByRoute: { r2: [buildPoi("r2-poi", "r2", 100)] },
      enabledCategories: ["water"],
      starredPOIIds: new Set(),
    });

    expect(visible.map((poi) => [poi.id, poi.effectiveDistanceMeters])).toEqual([
      ["r2-poi", 1_100],
    ]);
  });

  it("uses bucketed progress so list labels stay stable inside a bucket", () => {
    const poi = toDisplayPOI(buildPoi("water", "r1", 1_500));
    const input = {
      pois: [poi],
      routePoints: [buildRoutePoint(0, 0), buildRoutePoint(2_000, 1)],
      cumulativeTime: [0, 200],
      starredPOIIds: new Set<string>(),
      units: "metric" as const,
    };

    const first = buildPOIListRowModels({
      ...input,
      currentDistanceMeters: bucketDistanceForDerivedWork(1_020),
    });
    const second = buildPOIListRowModels({
      ...input,
      currentDistanceMeters: bucketDistanceForDerivedWork(1_080),
    });
    const crossed = buildPOIListRowModels({
      ...input,
      currentDistanceMeters: bucketDistanceForDerivedWork(1_120),
    });

    expect(first[0].distanceText).toBe(second[0].distanceText);
    expect(crossed[0].distanceText).not.toBe(first[0].distanceText);
  });

  it("builds compact starred models from route-scoped POIs", () => {
    const starred = buildStarredPOIsForActiveRoute({
      routeIds: ["r1"],
      segments: null,
      poisByRoute: {
        r1: [buildPoi("starred", "r1", 500), buildPoi("other", "r1", 700)],
      },
      starredPOIIds: new Set(["starred"]),
    });

    expect(starred.map((poi) => poi.id)).toEqual(["starred"]);
  });

  it("marks POI rows by whether the place is open at ETA", () => {
    const poi = toDisplayPOI(
      buildPoi("evening", "r1", 1_000, {
        tags: { opening_hours: mondayEveningOnly },
      }),
    );

    const rows = buildPOIListRowModels({
      pois: [poi],
      currentDistanceMeters: 0,
      routePoints: [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)],
      cumulativeTime: [0, 6 * 60 * 60],
      etaStartTimeMs: mondayNoon.getTime(),
      starredPOIIds: new Set(),
      units: "metric",
    });

    expect(rows[0].etaOpeningText).toBe("Open @ ETA");
    expect(rows[0].etaOpeningColorKey).toBe("positive");
  });
});
