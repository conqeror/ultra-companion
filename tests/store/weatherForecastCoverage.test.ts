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
vi.mock("@/services/weatherClient", () => ({ fetchForecasts: mocks.fetch }));

const HOUR = 3600_000;
const NOW = Date.parse("2026-07-20T08:00:00Z");
const points: RoutePoint[] = [0, 10_000, 20_000].map((distance, idx) => ({
  idx,
  latitude: 48,
  longitude: 17 + distance / 75_000,
  elevationMeters: 0,
  distanceFromStartMeters: distance,
}));
const cumulativeTime = [0, 3600, 7200];

function forecasts(
  coordinates: { latitude: number; longitude: number }[],
  hours: number,
): HourlyForecast[] {
  return coordinates.map((coordinate) => ({
    ...coordinate,
    hours: Array.from({ length: hours }, (_, hour) => ({
      time: new Date(NOW + hour * HOUR).toISOString(),
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
  }));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

let weather: typeof import("@/store/weatherStore").useWeatherStore;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.resetModules();
  mocks.storage.clear();
  mocks.connected = true;
  mocks.fetch.mockReset();
  mocks.fetch.mockImplementation(async (coordinates, hours) => forecasts(coordinates, hours));
  weather = (await import("@/store/weatherStore")).useWeatherStore;
});

afterEach(() => vi.useRealTimers());

function expectFinishAt(time: number) {
  expect(weather.getState().timeline).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        phase: "route",
        routeDistanceMeters: 20_000,
        sampleKinds: expect.arrayContaining(["finish"]),
        etaTime: new Date(time).toISOString(),
      }),
    ]),
  );
}

describe("weather forecast temporal coverage", () => {
  it.each(["fetchWeather", "refreshWeatherNow"] as const)(
    "%s replaces a fresh 24-hour forecast when a later start needs a longer horizon",
    async (method) => {
      await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
      expect(mocks.fetch).toHaveBeenLastCalledWith(expect.any(Array), 24);
      const replacement = deferred<HourlyForecast[]>();
      mocks.fetch.mockReturnValueOnce(replacement.promise);

      const refresh = weather.getState()[method];
      const pending = refresh("route-a", points, 0, cumulativeTime, NOW + 23 * HOUR);

      expect(mocks.fetch).toHaveBeenLastCalledWith(expect.any(Array), 32);
      expect(weather.getState()).toMatchObject({
        routeCoverageUntilMeters: 10_000,
        fetchStatus: "fetching",
      });
      replacement.resolve(forecasts(points, 32));
      await pending;

      expectFinishAt(NOW + 25 * HOUR);
      expect(
        weather.getState().timeline.filter((point) => point.phase === "post-finish"),
      ).toHaveLength(5);
      expect(weather.getState().lastRefreshOutcome).toBe(
        method === "refreshWeatherNow" ? "success" : "idle",
      );
    },
  );

  it("reuses an already downloaded 96-hour forecast after moving the start", async () => {
    mocks.fetch.mockResolvedValueOnce(forecasts(points, 96));
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime, NOW + 23 * HOUR);

    expectFinishAt(NOW + 25 * HOUR);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps partial cache coverage offline without calling it up to date", async () => {
    await weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
    mocks.connected = false;
    await weather
      .getState()
      .refreshWeatherNow("route-a", points, 0, cumulativeTime, NOW + 23 * HOUR);

    expect(weather.getState()).toMatchObject({
      routeCoverageUntilMeters: 10_000,
      fetchStatus: "error",
      lastError: "Offline",
      lastRefreshOutcome: "error",
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["slower ETA", "long stop"])(
    "requests a longer forecast when a pending projection changes to %s",
    async (change) => {
      const first = deferred<HourlyForecast[]>();
      mocks.fetch.mockReturnValueOnce(first.promise);
      const pending = weather.getState().fetchWeather("route-a", points, 0, cumulativeTime);
      const times = change === "slower ETA" ? [0, 15 * 3600, 30 * 3600] : cumulativeTime;
      const stops =
        change === "long stop"
          ? [
              {
                poiId: "stop",
                distanceMeters: toDisplayDistanceMeters(10_000),
                durationSeconds: 28 * 3600,
              },
            ]
          : [];

      await weather.getState().fetchWeather("route-a", points, 0, times, null, stops);
      expect(mocks.fetch).toHaveBeenCalledTimes(2);
      expect(mocks.fetch).toHaveBeenLastCalledWith(expect.any(Array), 37);
      expectFinishAt(NOW + 30 * HOUR);
      first.resolve(forecasts(points, 24));
      await pending;

      expectFinishAt(NOW + 30 * HOUR);
      expect(JSON.parse(mocks.storage.get("cache")!).forecasts[0].hours).toHaveLength(37);
    },
  );

  it("does not repeatedly request time beyond the provider's maximum horizon", async () => {
    const times = [0, 250 * 3600, 500 * 3600];
    await weather.getState().fetchWeather("route-a", points, 0, times);
    await weather.getState().fetchWeather("route-a", points, 0, [...times]);

    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.fetch).toHaveBeenLastCalledWith(expect.any(Array), 384);
    expect(weather.getState().timeline.length).toBeGreaterThan(0);
  });
});
