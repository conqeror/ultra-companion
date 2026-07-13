import { describe, expect, it } from "vitest";
import { toDisplayClimb, toDisplayDistanceMeters, toDisplayPOI } from "@/services/displayDistance";
import { buildUpcomingTimeline, type UpcomingEvent } from "@/services/upcomingTimeline";
import { buildClimb } from "@/tests/fixtures/climb";
import { stitchedSegmentsFixture } from "@/tests/fixtures/collection";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { bucketDistanceForDerivedWork } from "@/utils/distanceBuckets";
import {
  buildUpcomingListItems,
  buildUpcomingRowModels,
  getUpcomingListItemType,
  getUpcomingRowItemType,
  type UpcomingListItemModel,
} from "@/utils/upcomingRowModels";

function dayHeaderLabels(items: UpcomingListItemModel[]): string[] {
  return items.filter((item) => item.itemType === "day-header").map((item) => item.label);
}

function poiEvent(id: string, distanceMeters: number, eta: Date | null): UpcomingEvent {
  return {
    id: `poi:${id}`,
    kind: "poi",
    distanceMeters: toDisplayDistanceMeters(distanceMeters),
    eta: eta
      ? {
          distanceMeters,
          ridingTimeSeconds: 60,
          eta,
        }
      : null,
    poi: toDisplayPOI(buildPoi(id, "r1", distanceMeters, { name: id })),
  };
}

describe("upcomingRowModels", () => {
  const mondayNoon = new Date(2026, 0, 5, 12, 0, 0);
  const mondayEveningOnly = JSON.stringify([
    { open: { day: 1, hour: 18, minute: 0 }, close: { day: 1, hour: 19, minute: 0 } },
  ]);

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

  it("uses opening status at ETA for POI subtitles", () => {
    const event: UpcomingEvent = {
      id: "poi:shop",
      kind: "poi",
      distanceMeters: toDisplayDistanceMeters(1_000),
      eta: {
        distanceMeters: 1_000,
        ridingTimeSeconds: 6 * 60 * 60,
        eta: new Date(mondayNoon.getTime() + 6 * 60 * 60 * 1000),
      },
      poi: toDisplayPOI(
        buildPoi("shop", "r1", 1_000, {
          category: "groceries",
          name: "Evening Shop",
          tags: { opening_hours: mondayEveningOnly },
        }),
      ),
    };

    const [row] = buildUpcomingRowModels({
      events: [event],
      currentDistanceMeters: 0,
      units: "metric",
    });

    expect(row.subtitle).toBe("Open @ ETA");
    expect(row.subtitleColor).toEqual({ kind: "theme", key: "positive" });
    expect(row.accessibilityLabel).toContain("Open @ ETA");
  });

  it("inserts day headers for ETA-backed rows without duplicating same-day headers", () => {
    const base = new Date(2026, 6, 8, 8, 0, 0);
    const rows = buildUpcomingRowModels({
      events: [
        poiEvent("morning", 1_000, new Date(2026, 6, 8, 10, 0, 0)),
        poiEvent("evening", 2_000, new Date(2026, 6, 8, 18, 0, 0)),
        poiEvent("tomorrow", 3_000, new Date(2026, 6, 9, 16, 0, 0)),
      ],
      currentDistanceMeters: 0,
      units: "metric",
    });

    const items = buildUpcomingListItems({ rows, etaBaseTimeMs: base.getTime() });

    expect(items.map(getUpcomingListItemType)).toEqual([
      "day-header",
      "poi",
      "poi",
      "day-header",
      "poi",
    ]);
    expect(dayHeaderLabels(items)).toEqual([
      "Day 1 · Today · Wed Jul 8",
      "Day 2 · Tomorrow · Thu Jul 9",
    ]);
  });

  it("keeps no-ETA rows in route order without creating day headers for them", () => {
    const base = new Date(2026, 6, 8, 8, 0, 0);
    const rows = buildUpcomingRowModels({
      events: [
        poiEvent("no-eta-before", 500, null),
        poiEvent("today", 1_000, new Date(2026, 6, 8, 10, 0, 0)),
        poiEvent("no-eta-between", 1_500, null),
        poiEvent("tomorrow", 2_000, new Date(2026, 6, 9, 16, 0, 0)),
      ],
      currentDistanceMeters: 0,
      units: "metric",
    });

    const items = buildUpcomingListItems({ rows, etaBaseTimeMs: base.getTime() });

    expect(items.map(getUpcomingListItemType)).toEqual([
      "poi",
      "day-header",
      "poi",
      "poi",
      "day-header",
      "poi",
    ]);
    expect(dayHeaderLabels(items)).toEqual([
      "Day 1 · Today · Wed Jul 8",
      "Day 2 · Tomorrow · Thu Jul 9",
    ]);
  });
});
