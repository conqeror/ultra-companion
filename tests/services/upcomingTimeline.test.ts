import { describe, expect, it, vi } from "vitest";
import { buildUpcomingTimeline, resolveUpcomingHorizonETA } from "@/services/upcomingTimeline";
import { toDisplayClimb, toDisplayPOI } from "@/services/displayDistance";
import { createRidingHorizonWindow } from "@/utils/ridingHorizon";
import { buildClimb } from "@/tests/fixtures/climb";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { stitchedSegmentsFixture } from "@/tests/fixtures/collection";
import { plannedStopsFromPOIs } from "@/services/plannedStops";

describe("upcomingTimeline", () => {
  it("clips events to the riding horizon and falls back to route start without progress", () => {
    const window = createRidingHorizonWindow(null, 2_500, { totalDistanceMeters: 6_000 });
    const events = buildUpcomingTimeline({
      pois: [
        toDisplayPOI(buildPoi("inside", "r1", 1_000)),
        toDisplayPOI(buildPoi("outside", "r1", 3_000)),
      ],
      starredPOIIds: new Set(["inside", "outside"]),
      climbs: [],
      segments: null,
      totalDistanceMeters: 6_000,
      currentDistanceMeters: null,
      horizonWindow: window,
    });

    expect(events.map((event) => event.id)).toEqual(["poi:inside"]);
  });

  it("sorts mixed events in route order", () => {
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("water", "r1", 700))],
      starredPOIIds: new Set(["water"]),
      climbs: [toDisplayClimb(buildClimb("easy", "r1", 1_000, 1_300))],
      segments: stitchedSegmentsFixture,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
    });

    expect(events.map((event) => event.id)).toEqual([
      "poi:water",
      "segment:r1:r2:1",
      "climb-span:easy",
      "finish",
    ]);
  });

  it("uses effective display distances for stitched collections", () => {
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("r2-poi", "r2", 100), 1_000)],
      starredPOIIds: new Set(["r2-poi"]),
      climbs: [toDisplayClimb(buildClimb("r2-climb", "r2", 200, 500), 1_000)],
      segments: stitchedSegmentsFixture,
      totalDistanceMeters: 3_000,
      currentDistanceMeters: 0,
    });

    expect(events.map((event) => [event.id, event.distanceMeters])).toContainEqual([
      "poi:r2-poi",
      1_100,
    ]);
    expect(events.map((event) => [event.id, event.distanceMeters])).toContainEqual([
      "climb-span:r2-climb",
      1_200,
    ]);
  });

  it("excludes unstarred fetched POIs and includes saved custom POIs", () => {
    const events = buildUpcomingTimeline({
      pois: [
        toDisplayPOI(buildPoi("unstarred", "r1", 500)),
        toDisplayPOI(buildPoi("saved", "r1", 800, { source: "custom" })),
      ],
      starredPOIIds: new Set(),
      climbs: [],
      segments: null,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
    });

    expect(events.map((event) => event.id)).toEqual(["poi:saved", "finish"]);
  });

  it("includes unstarred POIs with planned stops", () => {
    const events = buildUpcomingTimeline({
      pois: [
        toDisplayPOI(
          buildPoi("planned", "r1", 500, {
            tags: { planned_stop_duration_minutes: "15" },
          }),
        ),
      ],
      starredPOIIds: new Set(),
      climbs: [],
      segments: null,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
    });

    expect(events.map((event) => event.id)).toEqual(["poi:planned", "finish"]);
  });

  it("includes starred POIs inside the active horizon", () => {
    const window = createRidingHorizonWindow(1_000, 1_000, { totalDistanceMeters: 5_000 });
    const events = buildUpcomingTimeline({
      pois: [
        toDisplayPOI(buildPoi("behind", "r1", 900)),
        toDisplayPOI(buildPoi("ahead", "r1", 1_600)),
        toDisplayPOI(buildPoi("far", "r1", 2_200)),
      ],
      starredPOIIds: new Set(["behind", "ahead", "far"]),
      climbs: [],
      segments: null,
      totalDistanceMeters: 5_000,
      currentDistanceMeters: 1_000,
      horizonWindow: window,
    });

    expect(events.map((event) => event.id)).toEqual(["poi:ahead"]);
  });

  it("splits moderate climbs and easy climbs with important POIs, but collapses isolated easy climbs", () => {
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("inside-easy", "r1", 2_200))],
      starredPOIIds: new Set(["inside-easy"]),
      climbs: [
        toDisplayClimb(buildClimb("easy", "r1", 1_000, 1_500, { difficultyScore: 100 })),
        toDisplayClimb(buildClimb("medium", "r1", 3_000, 3_800, { difficultyScore: 150 })),
        toDisplayClimb(buildClimb("easy-poi", "r1", 2_000, 2_500, { difficultyScore: 100 })),
      ],
      segments: null,
      totalDistanceMeters: 5_000,
      currentDistanceMeters: 0,
    });

    expect(events.map((event) => event.id)).toEqual([
      "climb-span:easy",
      "climb-start:easy-poi",
      "poi:inside-easy",
      "climb-top:easy-poi",
      "climb-start:medium",
      "climb-top:medium",
      "finish",
    ]);
  });

  it("keeps rows visible without ETA data", () => {
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("water", "r1", 1_000))],
      starredPOIIds: new Set(["water"]),
      climbs: [],
      segments: null,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
      routePoints: null,
      cumulativeTime: null,
    });

    expect(events[0]).toMatchObject({ id: "poi:water", eta: null });
    expect(
      resolveUpcomingHorizonETA({
        totalDistanceMeters: 2_000,
        currentDistanceMeters: 0,
        routePoints: null,
        cumulativeTime: null,
      }),
    ).toBeNull();
  });

  it("attaches ETA when cumulative route timing is available", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

    const routePoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("water", "r1", 1_500))],
      starredPOIIds: new Set(["water"]),
      climbs: [],
      segments: null,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 500,
      routePoints,
      cumulativeTime: [0, 100, 200],
    });

    expect(events[0].eta?.distanceMeters).toBe(1_000);
    expect(events[0].eta?.ridingTimeSeconds).toBe(100);
    expect(events[0].eta?.eta.toISOString()).toBe("2026-01-01T12:01:40.000Z");

    vi.useRealTimers();
  });

  it("uses a race start datetime as the ETA clock base when provided", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T05:00:00.000Z"));

    const routePoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];
    const raceStartMs = new Date("2026-01-01T06:00:00.000Z").getTime();
    const events = buildUpcomingTimeline({
      pois: [toDisplayPOI(buildPoi("water", "r1", 1_500))],
      starredPOIIds: new Set(["water"]),
      climbs: [],
      segments: null,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
      routePoints,
      cumulativeTime: [0, 100, 200],
      etaStartTimeMs: raceStartMs,
    });

    expect(events[0].eta?.ridingTimeSeconds).toBe(150);
    expect(events[0].eta?.eta.toISOString()).toBe("2026-01-01T06:02:30.000Z");
    expect(
      resolveUpcomingHorizonETA({
        totalDistanceMeters: 2_000,
        currentDistanceMeters: 0,
        routePoints,
        cumulativeTime: [0, 100, 200],
        etaStartTimeMs: raceStartMs,
      })?.eta.toISOString(),
    ).toBe("2026-01-01T06:03:20.000Z");

    vi.useRealTimers();
  });

  it("applies planned stop offsets only to downstream event ETAs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T12:00:00.000Z"));

    const routePoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];
    const pois = [
      toDisplayPOI(
        buildPoi("planned", "r1", 1_000, {
          tags: { planned_stop_duration_minutes: "15" },
        }),
      ),
    ];
    const events = buildUpcomingTimeline({
      pois,
      starredPOIIds: new Set(),
      climbs: [],
      segments: null,
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
      routePoints,
      cumulativeTime: [0, 100, 200],
      plannedStops: plannedStopsFromPOIs(pois),
    });

    expect(events.find((event) => event.id === "poi:planned")?.eta?.ridingTimeSeconds).toBe(100);
    expect(events.find((event) => event.id === "finish")?.eta?.ridingTimeSeconds).toBe(1_100);

    vi.useRealTimers();
  });

  it("combines race start clock base with prior planned stops", () => {
    const routePoints = [
      buildRoutePoint(0, 0),
      buildRoutePoint(1_000, 1),
      buildRoutePoint(2_000, 2),
    ];
    const pois = [
      toDisplayPOI(
        buildPoi("planned", "r1", 1_000, {
          tags: { planned_stop_duration_minutes: "15" },
        }),
      ),
    ];
    const eta = resolveUpcomingHorizonETA({
      totalDistanceMeters: 2_000,
      currentDistanceMeters: 0,
      routePoints,
      cumulativeTime: [0, 100, 200],
      etaStartTimeMs: new Date("2026-01-01T06:00:00.000Z").getTime(),
      plannedStops: plannedStopsFromPOIs(pois),
    });

    expect(eta?.ridingTimeSeconds).toBe(1_100);
    expect(eta?.eta.toISOString()).toBe("2026-01-01T06:18:20.000Z");
  });
});
