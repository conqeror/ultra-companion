import { afterEach, describe, expect, it, vi } from "vitest";
import { buildWeatherTimeline, sampleWaypoints } from "@/services/weatherService";
import type { HourlyForecast } from "@/services/weatherClient";
import type { DisplayDistanceMeters, RoutePoint } from "@/types";

const { mockFetchForecasts } = vi.hoisted(() => ({
  mockFetchForecasts: vi.fn(),
}));

vi.mock("@/services/weatherClient", () => ({
  fetchForecasts: mockFetchForecasts,
}));

const DEG_PER_METER = 1 / 111_320;

function point(idx: number, distanceFromStartMeters: number, latitude = 0): RoutePoint {
  return {
    latitude,
    longitude: distanceFromStartMeters * DEG_PER_METER,
    elevationMeters: 0,
    distanceFromStartMeters,
    idx,
  };
}

function routePoint(distanceFromStartMeters: number, idx: number): RoutePoint {
  return {
    latitude: 48 + idx * 0.1,
    longitude: 17 + idx * 0.1,
    elevationMeters: 100,
    distanceFromStartMeters,
    idx,
  };
}

function forecast(latitude: number, longitude: number): HourlyForecast {
  return {
    latitude,
    longitude,
    hours: Array.from({ length: 48 }, (_, hour) => ({
      time: new Date(Date.UTC(2026, 0, 1, hour)).toISOString(),
      temperature2m: hour,
      apparentTemperature2m: hour - 2,
      dewPoint2m: hour - 4,
      relativeHumidity2m: 65,
      precipitation: 0,
      precipitationProbability: 0,
      weatherCode: 0,
      windSpeed10m: 10,
      windDirection10m: 180,
      windGusts10m: 15,
      isDay: 1,
    })),
  };
}

describe("weatherService", () => {
  afterEach(() => {
    vi.useRealTimers();
    mockFetchForecasts.mockReset();
  });

  it("samples the first weather waypoint from projected route progress", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 2_000)];

    const waypoints = sampleWaypoints(points, 250);

    expect(waypoints[0]).toMatchObject({
      distanceAlongRouteM: 0,
      routeDistanceMeters: 250,
      index: 0,
    });
    expect(waypoints[0].longitude).toBeCloseTo(250 * DEG_PER_METER, 8);
  });

  it("samples exact collection joins from the forward segment", () => {
    const points = [point(0, 0, 0), point(1, 1_000, 0), point(2, 1_000, 1), point(3, 2_000, 2)];

    const waypoints = sampleWaypoints(points, 1_000);

    expect(waypoints[0]).toMatchObject({
      index: 2,
      segmentIndex: 2,
      latitude: 1,
    });
  });

  it("returns no weather waypoints for out-of-range progress", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 2_000)];

    expect(sampleWaypoints(points, -1)).toEqual([]);
    expect(sampleWaypoints(points, 2_001)).toEqual([]);
  });

  it("uses planned projection start time to shift weather timeline alignment", async () => {
    const points = [routePoint(0, 0), routePoint(20_000, 1), routePoint(40_000, 2)];
    const cumulativeTime = [0, 3600, 7200];
    mockFetchForecasts.mockResolvedValue(
      points.map((sample) => forecast(sample.latitude, sample.longitude)),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T10:30:00.000Z"));

    const plannedTimeline = await buildWeatherTimeline(points, 0, cumulativeTime, {
      projectionStartTime: new Date("2026-01-01T12:30:00.000Z"),
    });

    expect(plannedTimeline[0]).toMatchObject({
      phase: "route",
      sampleKind: "hourly",
      sampleKinds: ["hourly"],
      time: "2026-01-01T12:00:00.000Z",
      etaTime: "2026-01-01T12:30:00.000Z",
      temperatureC: 12,
      apparentTemperatureC: 10,
      dewPointC: 8,
      relativeHumidityPercent: 65,
    });
    expect(plannedTimeline.map((weatherPoint) => weatherPoint.sampleKind)).toEqual([
      "hourly",
      "distance",
      "hourly",
      "distance",
      "hourly",
      "post-finish",
      "post-finish",
      "post-finish",
      "post-finish",
      "post-finish",
    ]);
    expect(plannedTimeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sampleKind: "hourly",
          sampleKinds: ["hourly", "finish"],
          routeDistanceMeters: 40_000,
        }),
      ]),
    );
    expect(mockFetchForecasts).toHaveBeenLastCalledWith(expect.any(Array), 24);
  });

  it("includes prior planned stop durations in route weather ETA times", async () => {
    const points = [routePoint(0, 0), routePoint(10_000, 1), routePoint(20_000, 2)];
    const cumulativeTime = [0, 3600, 7200];
    mockFetchForecasts.mockResolvedValue(
      points.map((sample) => forecast(sample.latitude, sample.longitude)),
    );

    const timeline = await buildWeatherTimeline(points, 0, cumulativeTime, {
      projectionStartTime: new Date("2026-01-01T00:30:00.000Z"),
      plannedStops: [
        {
          poiId: "stop",
          distanceMeters: 10_000 as DisplayDistanceMeters,
          durationSeconds: 1800,
        },
      ],
    });

    const finish = timeline.find(
      (weatherPoint) =>
        weatherPoint.phase === "route" && weatherPoint.sampleKinds.includes("finish"),
    );
    expect(finish).toMatchObject({
      routeDistanceMeters: 20_000,
      etaTime: "2026-01-01T03:00:00.000Z",
    });
  });

  it("keeps weather samples during planned stops at the stop location", async () => {
    const points = [routePoint(0, 0), routePoint(10_000, 1), routePoint(20_000, 2)];
    const cumulativeTime = [0, 1800, 3600];
    mockFetchForecasts.mockResolvedValue(
      points.map((sample) => forecast(sample.latitude, sample.longitude)),
    );

    const timeline = await buildWeatherTimeline(points, 0, cumulativeTime, {
      projectionStartTime: new Date("2026-01-01T00:00:00.000Z"),
      plannedStops: [
        {
          poiId: "stop",
          distanceMeters: 15_000 as DisplayDistanceMeters,
          durationSeconds: 7200,
        },
      ],
    });

    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sampleKind: "hourly",
          routeDistanceMeters: 15_000,
          etaTime: "2026-01-01T01:00:00.000Z",
        }),
      ]),
    );
  });

  it("samples the full remaining route for all-route weather coverage", async () => {
    const points = Array.from({ length: 14 }, (_, index) => routePoint(index * 20_000, index));
    const cumulativeTime = points.map((_, index) => index * 3600);
    mockFetchForecasts.mockResolvedValue(
      points.map((sample) => forecast(sample.latitude, sample.longitude)),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:30:00.000Z"));

    const timeline = await buildWeatherTimeline(points, 0, cumulativeTime);

    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ phase: "route", routeDistanceMeters: 260_000 }),
      ]),
    );
    expect(timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sampleKind: "hourly", routeDistanceMeters: 0 }),
        expect.objectContaining({ sampleKind: "distance", routeDistanceMeters: 10_000 }),
      ]),
    );
    expect(mockFetchForecasts).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ latitude: points[points.length - 1].latitude }),
      ]),
      expect.any(Number),
    );
  });

  it("caps requested forecast hours to the Open-Meteo limit", async () => {
    const points = [routePoint(0, 0), routePoint(40_000, 1)];
    const cumulativeTime = [0, 500 * 3600];
    mockFetchForecasts.mockResolvedValue(
      points.map((sample) => forecast(sample.latitude, sample.longitude)),
    );
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:30:00.000Z"));

    await buildWeatherTimeline(points, 0, cumulativeTime);

    expect(mockFetchForecasts).toHaveBeenCalledWith(expect.any(Array), 384);
  });
});
