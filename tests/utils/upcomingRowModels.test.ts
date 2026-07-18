import { describe, expect, it } from "vitest";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { toDisplayClimb, toDisplayDistanceMeters, toDisplayPOI } from "@/services/displayDistance";
import { computeRouteETA } from "@/services/etaCalculator";
import { toDisplayFerryCrossing } from "@/services/ferryCrossings";
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
import type { FerryCrossing } from "@/types";

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
      subtitleNumberOfLines: 1,
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

  it("shows a ferry row with separate quay and landing ETAs", () => {
    const routePoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
      buildRoutePoint(3_000, 3),
      buildRoutePoint(4_000, 4),
    ];
    const ferry = toDisplayFerryCrossing(ferryCrossing());
    const cumulativeTime = computeRouteETA(routePoints, DEFAULT_POWER_CONFIG, [ferry]);
    const etaStartTimeMs = new Date("2026-01-01T06:00:00.000Z").getTime();
    const events = buildUpcomingTimeline({
      pois: [],
      starredPOIIds: new Set(),
      climbs: [],
      ferries: [ferry],
      segments: null,
      totalDistanceMeters: 4_000,
      currentDistanceMeters: 0,
      routePoints,
      cumulativeTime,
      etaStartTimeMs,
    });
    const ferryEvent = events.find((event) => event.kind === "ferry");

    expect(ferryEvent?.kind).toBe("ferry");
    if (!ferryEvent || ferryEvent.kind !== "ferry") throw new Error("Missing ferry event");
    expect(ferryEvent.eta?.ridingTimeSeconds).toBeCloseTo(cumulativeTime[1]);
    expect(ferryEvent.landingEta?.ridingTimeSeconds).toBeCloseTo(cumulativeTime[3]);
    expect(ferryEvent.eta?.eta.getTime()).toBe(
      Math.floor(etaStartTimeMs + cumulativeTime[1] * 1_000),
    );
    expect(ferryEvent.landingEta?.eta.getTime()).toBe(
      Math.floor(etaStartTimeMs + cumulativeTime[3] * 1_000),
    );

    const [row] = buildUpcomingRowModels({
      events: [ferryEvent],
      currentDistanceMeters: 0,
      units: "metric",
      ferries: [ferry],
    });

    expect(row).toMatchObject({
      itemType: "ferry",
      title: "Test ferry",
      subtitle: "5 min crossing\n3 min assumed wait",
      subtitleNumberOfLines: 2,
      hasFerryInterval: true,
      isPressable: false,
    });
    expect(row.clockLabel).not.toBe("--:--");
    expect(row.ferryLandingLabel).not.toBeNull();
    expect(row.ferryLandingLabel).not.toBe(row.clockLabel);
    expect(row.accessibilityLabel).toContain(`ETA ${row.clockLabel}`);
    expect(row.accessibilityLabel).toContain(`land ${row.ferryLandingLabel}`);

    const [activeRow] = buildUpcomingRowModels({
      events: [{ ...ferryEvent, isActive: true }],
      currentDistanceMeters: 2_000,
      units: "metric",
      ferries: [ferry],
    });
    expect(activeRow).toMatchObject({
      subtitle: "On ferry\n5 min crossing\n3 min assumed wait",
      subtitleNumberOfLines: 3,
    });
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
