import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RoutePoint } from "@/types";
import type { HourlyForecast } from "@/services/weatherClient";
import { toDisplayDistanceMeters } from "@/services/displayDistance";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  storage: new Map<string, string>(),
  connected: true,
}));
vi.mock("@/lib/keyValueStorage", () => ({
  createKeyValueStorage: () => ({
    getString: (key: string) => mocks.storage.get(key),
    set: (key: string, value: string) => mocks.storage.set(key, value),
  }),
}));
vi.mock("@/store/offlineStore", () => ({
  useOfflineStore: { getState: () => ({ isConnected: mocks.connected }) },
}));
vi.mock("@/services/weatherService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/weatherService")>()),
  fetchWeatherForecastsForRoute: mocks.fetch,
}));

const NOW = Date.parse("2026-07-20T08:00:00Z");
const points: RoutePoint[] = [0, 10_000, 20_000].map((distance, idx) => ({
  idx,
  latitude: 48,
  longitude: 17 + distance / 75_000,
  elevationMeters: 0,
  distanceFromStartMeters: distance,
}));
const cumulativeTime = [0, 3600, 7200];

function forecast(point: RoutePoint): HourlyForecast {
  return {
    latitude: point.latitude,
    longitude: point.longitude,
    hours: Array.from({ length: 96 }, (_, hour) => ({
      time: new Date(NOW + hour * 3600_000).toISOString(),
      temperature2m: hour,
      apparentTemperature2m: hour,
      dewPoint2m: 0,
      relativeHumidity2m: 50,
      precipitation: 0,
      precipitationProbability: 0,
      weatherCode: 0,
      windSpeed10m: 10,
      windDirection10m: 0,
      windGusts10m: 15,
      isDay: 1,
    })),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

let weather: typeof import("@/store/weatherStore").useWeatherStore;

function finishTime(): number {
  const finish = weather
    .getState()
    .timeline.find((point) => point.phase === "route" && point.sampleKinds.includes("finish"));
  expect(finish).toBeDefined();
  return Date.parse(finish!.etaTime);
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.resetModules();
  mocks.storage.clear();
  mocks.connected = true;
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (routePoints: RoutePoint[]) => routePoints.map(forecast));
  weather = (await import("@/store/weatherStore")).useWeatherStore;
});

afterEach(() => vi.useRealTimers());

describe("weather projections and forecast ownership", () => {
  it("persists source forecasts separately and publishes a complete projection context", async () => {
    const plannedStops = [
      { poiId: "stop", distanceMeters: toDisplayDistanceMeters(10_000), durationSeconds: 1800 },
    ];
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime, null, plannedStops);

    expect(finishTime()).toBe(NOW + 9000_000);
    expect(weather.getState()).toMatchObject({
      routeId: "route-a",
      plannedStopSignature: "10000:1800",
      projectionContext: { routeId: "route-a", plannedStopSignature: "10000:1800" },
      fetchStatus: "done",
      lastSuccessfulFetchAtMs: NOW,
    });
    const cached = JSON.parse(mocks.storage.get("cache")!);
    expect(cached.version).toBe(4);
    expect(cached.forecasts).toHaveLength(points.length);
    expect(cached.timeline).toBeUndefined();
  });

  it("avoids fetching or rebuilding an unchanged fresh projection", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    const timeline = weather.getState().timeline;
    await weather.getState().fetchWeather("route-a", [...points], 10, [...cumulativeTime]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(weather.getState().timeline).toBe(timeline);
  });

  it("reprojects changed ETA values using downloaded forecasts, including changed intermediate timing", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    const oldKey = weather.getState().projectionContext?.etaKey;
    await weather.getState().fetchWeather("route-a", points, 0, [0, 7200, 14_400]);
    expect(finishTime()).toBe(NOW + 14_400_000);
    expect(weather.getState().projectionContext?.etaKey).not.toBe(oldKey);
    const doubledKey = weather.getState().projectionContext?.etaKey;
    await weather.getState().fetchWeather("route-a", points, 0, [0, 3600, 14_400]);
    expect(weather.getState().projectionContext?.etaKey).not.toBe(doubledKey);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("reuses forecast locations for a nearby geometry change and downloads a distant variant", async () => {
    await weather.getState().fetchWeather("collection-a", points, 0, cumulativeTime);
    const nearby = points.map((point) => ({ ...point, longitude: point.longitude + 0.01 }));
    await weather.getState().fetchWeather("collection-a", nearby, 0, cumulativeTime);
    expect(weather.getState().timeline[0].longitude).toBe(nearby[0].longitude);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);

    const distant = points.map((point) => ({ ...point, longitude: point.longitude + 5 }));
    await weather.getState().fetchWeather("collection-a", distant, 0, cumulativeTime);
    expect(weather.getState().timeline[0].longitude).toBe(distant[0].longitude);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("reprojects start and stop changes without unnecessary network requests", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    await weather
      .getState()
      .fetchWeather("route-a", points, 0, cumulativeTime, NOW + 3600_000, [
        { poiId: "stop", distanceMeters: toDisplayDistanceMeters(10_000), durationSeconds: 1800 },
      ]);
    expect(finishTime()).toBe(NOW + 12_600_000);
    expect(weather.getState().plannedStartMs).toBe(NOW + 3600_000);
    expect(weather.getState().plannedStopSignature).toBe("10000:1800");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("rebuilds cached forecasts for changed progress and ETA while offline, retaining stale status", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    mocks.connected = false;
    vi.setSystemTime(NOW + 2 * 3600_000);
    await weather.getState().fetchWeather("route-a", points, 10_000, [0, 7200, 14_400]);
    expect(weather.getState().timeline[0].routeDistanceMeters).toBe(10_000);
    expect(finishTime()).toBe(NOW + 4 * 3600_000);
    expect(weather.getState()).toMatchObject({ fetchStatus: "error", lastError: "Offline" });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("never displays the previous route's projection after an offline route switch", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    mocks.connected = false;
    await weather.getState().fetchWeather("route-b", points, 0, cumulativeTime);
    expect(weather.getState()).toMatchObject({
      timeline: [],
      routeId: null,
      projectionContext: null,
      requestContext: { routeId: "route-b" },
      fetchStatus: "error",
      lastError: "Offline",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("starts a newly selected route while another is pending and rejects its late result", async () => {
    const first = deferred<HourlyForecast[]>();
    mocks.fetch.mockReturnValueOnce(first.promise);
    const pending = weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    await weather.getState().fetchWeather("route-b", points, 0, cumulativeTime);
    first.resolve(points.map(forecast));
    await pending;
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(weather.getState().routeId).toBe("route-b");
    expect(JSON.parse(mocks.storage.get("cache")!).routeId).toBe("route-b");
  });

  it("does not let a superseded failure overwrite the current route's manual success", async () => {
    const first = deferred<HourlyForecast[]>();
    mocks.fetch.mockReturnValueOnce(first.promise);
    const pending = weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    await weather.getState().refreshWeatherNow("route-b", points, 0, cumulativeTime);
    first.reject(new Error("old route failed"));
    await pending;
    expect(weather.getState()).toMatchObject({
      routeId: "route-b",
      fetchStatus: "done",
      lastError: null,
      lastRefreshOutcome: "success",
    });
  });

  it("shares an in-flight forecast download while publishing only the latest ETA projection", async () => {
    const first = deferred<HourlyForecast[]>();
    mocks.fetch.mockReturnValueOnce(first.promise);
    const oldProjection = weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    const newProjection = weather.getState().fetchWeather("route-a", points, 0, [0, 7200, 14_400]);
    first.resolve(points.map(forecast));
    await Promise.all([oldProjection, newProjection]);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(finishTime()).toBe(NOW + 14_400_000);
    expect(weather.getState().fetchStatus).toBe("done");
  });

  it("invalidates pending publication and persistence when weather is cleared", async () => {
    const first = deferred<HourlyForecast[]>();
    mocks.fetch.mockReturnValueOnce(first.promise);
    const pending = weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    weather.getState().clearWeather();
    first.resolve(points.map(forecast));
    await pending;
    expect(weather.getState()).toMatchObject({ timeline: [], fetchStatus: "idle", routeId: null });
    expect(mocks.storage.get("cache")).toBe("");
  });

  it("retains manual throttling while updating the projection and reports a later refresh success", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    await weather.getState().refreshWeatherNow("route-a", points, 0, [0, 7200, 14_400]);
    expect(finishTime()).toBe(NOW + 14_400_000);
    expect(weather.getState().lastRefreshOutcome).toBe("skipped-fresh");
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(NOW + 11 * 60_000);
    await weather.getState().refreshWeatherNow("route-a", points, 0, cumulativeTime);
    expect(weather.getState().lastRefreshOutcome).toBe("success");
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
  });

  it("reports duplicate manual refreshes as unavailable and allows retry after failure", async () => {
    const first = deferred<HourlyForecast[]>();
    mocks.fetch.mockReturnValueOnce(first.promise);
    const pending = weather.getState().refreshWeatherNow("route-a", points, 0, cumulativeTime);
    await weather.getState().refreshWeatherNow("route-a", points, 0, cumulativeTime);
    expect(weather.getState().lastRefreshOutcome).toBe("unavailable");
    first.reject(new Error("Network failed"));
    await pending;
    expect(weather.getState().lastRefreshOutcome).toBe("error");
    await weather.getState().refreshWeatherNow("route-a", points, 0, cumulativeTime);
    expect(weather.getState()).toMatchObject({ lastRefreshOutcome: "success", lastError: null });
  });

  it("clears the already-in-progress message when an automatic download completes", async () => {
    const first = deferred<HourlyForecast[]>();
    mocks.fetch.mockReturnValueOnce(first.promise);
    const pending = weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    await weather.getState().refreshWeatherNow("route-a", points, 0, cumulativeTime);
    expect(weather.getState().lastRefreshOutcome).toBe("unavailable");
    first.resolve(points.map(forecast));
    await pending;
    expect(weather.getState()).toMatchObject({
      fetchStatus: "done",
      lastRefreshOutcome: "idle",
      lastRefreshMessage: null,
    });
  });

  it("rebuilds legacy cached forecasts offline instead of hydrating an unverified old timeline", async () => {
    mocks.storage.set(
      "cache",
      JSON.stringify({
        version: 3,
        routeId: "route-a",
        fetchedAt: NOW,
        fromDistanceAlongRouteMeters: 0,
        forecasts: points.map(forecast),
        timeline: [{ routeDistanceMeters: 999_999 }],
      }),
    );
    vi.resetModules();
    weather = (await import("@/store/weatherStore")).useWeatherStore;
    mocks.connected = false;
    expect(weather.getState().timeline).toEqual([]);
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    expect(finishTime()).toBe(NOW + 7200_000);
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(weather.getState().fetchStatus).toBe("done");
  });
});
