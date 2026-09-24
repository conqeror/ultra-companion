import { create } from "zustand";
import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import type { RoutePoint, WeatherFetchStatus, WeatherPoint } from "@/types";
import { WEATHER_MANUAL_REFRESH_THROTTLE_MS, WEATHER_STALE_MS } from "@/constants";
import {
  buildWeatherTimelineFromForecasts,
  fetchWeatherForecastsForRoute,
  getWeatherForecastRequirements,
} from "@/services/weatherService";
import type { PlannedStop } from "@/services/plannedStops";
import {
  canReuseWeatherForecasts,
  createWeatherProjectionInput,
  hasWeatherForecastTimeCoverage,
  weatherProjectionKey,
  type WeatherForecastCache,
  type WeatherProjectionContext,
  type WeatherProjectionInput,
} from "@/services/weatherProjection";
import { useOfflineStore } from "./offlineStore";

let storage: KeyValueStorage | null = null;
const WEATHER_CACHE_VERSION = 4;

function getStorage(): KeyValueStorage {
  storage ??= createKeyValueStorage("weather");
  return storage;
}

export type WeatherManualRefreshOutcome =
  | "idle"
  | "unavailable"
  | "skipped-fresh"
  | "success"
  | "error";

type FetchMode = "automatic" | "manual";

function loadCache(): WeatherForecastCache | null {
  try {
    const raw = getStorage().getString("cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WeatherForecastCache> & { version?: number };
    if (parsed.version !== WEATHER_CACHE_VERSION && parsed.version !== 3) return null;
    if (!Array.isArray(parsed.forecasts) || typeof parsed.routeId !== "string") return null;
    if (typeof parsed.fetchedAt !== "number" || !Number.isFinite(parsed.fetchedAt)) return null;
    return {
      routeId: parsed.routeId,
      geometryKey: typeof parsed.geometryKey === "string" ? parsed.geometryKey : null,
      fromDistanceAlongRouteMeters: parsed.fromDistanceAlongRouteMeters ?? 0,
      forecasts: parsed.forecasts,
      fetchedAt: parsed.fetchedAt,
    };
  } catch {
    return null;
  }
}

function persistCache(cache: WeatherForecastCache | null): void {
  try {
    getStorage().set(
      "cache",
      cache ? JSON.stringify({ version: WEATHER_CACHE_VERSION, ...cache }) : "",
    );
  } catch {}
}

function isFresh(fetchedAt: number | null, maxAge = WEATHER_STALE_MS): boolean {
  return fetchedAt != null && Date.now() - fetchedAt < maxAge;
}

const EMPTY_PROJECTION = {
  timeline: [] as WeatherPoint[],
  projectionContext: null as WeatherProjectionContext | null,
  lastSuccessfulFetchAtMs: null as number | null,
  forecastFromMs: null as number | null,
  forecastUntilMs: null as number | null,
  routeCoverageFromMeters: null as number | null,
  routeCoverageUntilMeters: null as number | null,
  routeId: null as string | null,
  plannedStartMs: null as number | null,
  plannedStopSignature: "none",
  fromDistanceAlongRouteMeters: null as number | null,
};

interface WeatherState {
  timeline: WeatherPoint[];
  projectionContext: WeatherProjectionContext | null;
  requestContext: WeatherProjectionContext | null;
  fetchStatus: WeatherFetchStatus;
  lastSuccessfulFetchAtMs: number | null;
  lastFailedFetchAtMs: number | null;
  lastAttemptedAtMs: number | null;
  lastError: string | null;
  lastRefreshOutcome: WeatherManualRefreshOutcome;
  lastRefreshMessage: string | null;
  forecastFromMs: number | null;
  forecastUntilMs: number | null;
  routeCoverageFromMeters: number | null;
  routeCoverageUntilMeters: number | null;
  routeId: string | null;
  plannedStartMs: number | null;
  plannedStopSignature: string;
  fromDistanceAlongRouteMeters: number | null;

  fetchWeather: (
    routeId: string,
    points: RoutePoint[],
    fromDistanceAlongRouteMeters: number,
    cumulativeTime: number[],
    plannedStartMs?: number | null,
    plannedStops?: readonly PlannedStop[],
  ) => Promise<void>;
  refreshWeatherNow: WeatherState["fetchWeather"];
  recordManualRefreshUnavailable: (message?: string) => void;
  clearWeather: () => void;
}

export const useWeatherStore = create<WeatherState>((set, get) => {
  let forecastCache = loadCache();
  let generation = 0;
  const pendingForecasts = new Map<string, Promise<WeatherForecastCache>>();

  function publishProjection(
    input: WeatherProjectionInput,
    cache: WeatherForecastCache,
    manualOutcome?: "success" | "skipped-fresh",
  ): boolean {
    const { context, points, cumulativeTime, plannedStops } = input;
    const result = buildWeatherTimelineFromForecasts(
      points,
      context.fromDistanceAlongRouteMeters,
      cumulativeTime,
      cache.forecasts,
      {
        ...(context.plannedStartMs != null
          ? { projectionStartTime: new Date(context.plannedStartMs) }
          : {}),
        plannedStops,
      },
    );
    if (result.timeline.length === 0) return false;
    set({
      ...result,
      projectionContext: context,
      routeId: context.routeId,
      plannedStartMs: context.plannedStartMs,
      plannedStopSignature: context.plannedStopSignature,
      fromDistanceAlongRouteMeters: context.fromDistanceAlongRouteMeters,
      lastSuccessfulFetchAtMs: cache.fetchedAt,
      fetchStatus: "done",
      lastFailedFetchAtMs: null,
      lastError: null,
      lastRefreshOutcome: manualOutcome ?? "idle",
      lastRefreshMessage: manualOutcome === "skipped-fresh" ? "Already up to date" : null,
    });
    return true;
  }

  function recordFailure(message: string): void {
    set({
      fetchStatus: "error",
      lastFailedFetchAtMs: Date.now(),
      lastError: message,
      lastRefreshOutcome: "error",
      lastRefreshMessage: message,
    });
  }

  async function runFetch(input: WeatherProjectionInput, mode: FetchMode): Promise<void> {
    const { context, points, cumulativeTime, plannedStops } = input;
    const key = weatherProjectionKey(context);
    const options = {
      ...(context.plannedStartMs != null
        ? { projectionStartTime: new Date(context.plannedStartMs) }
        : {}),
      plannedStops,
    };
    const requirements = getWeatherForecastRequirements(
      points,
      context.fromDistanceAlongRouteMeters,
      cumulativeTime,
      options,
    );
    const state = get();
    if (
      state.fetchStatus === "fetching" &&
      state.requestContext &&
      weatherProjectionKey(state.requestContext) === key
    ) {
      if (mode === "manual") {
        set({
          lastRefreshOutcome: "unavailable",
          lastRefreshMessage: "Weather refresh already in progress",
        });
      }
      return;
    }
    if (
      mode === "automatic" &&
      state.projectionContext &&
      weatherProjectionKey(state.projectionContext) === key &&
      isFresh(state.lastSuccessfulFetchAtMs) &&
      hasWeatherForecastTimeCoverage(forecastCache, requirements) &&
      state.fetchStatus === "done"
    ) {
      return;
    }

    const requestGeneration = ++generation;
    const sameRouteGeometry =
      state.projectionContext?.routeId === context.routeId &&
      state.projectionContext.geometryKey === context.geometryKey;
    set({
      requestContext: context,
      ...(!sameRouteGeometry ? EMPTY_PROJECTION : {}),
      lastRefreshOutcome: "idle",
      lastRefreshMessage: null,
    });

    const reusableCache = canReuseWeatherForecasts(forecastCache, input) ? forecastCache : null;
    const useCache =
      reusableCache != null &&
      hasWeatherForecastTimeCoverage(reusableCache, requirements) &&
      (mode === "automatic"
        ? isFresh(reusableCache.fetchedAt)
        : isFresh(reusableCache.fetchedAt, WEATHER_MANUAL_REFRESH_THROTTLE_MS));
    const projectedFromCache =
      reusableCache != null &&
      publishProjection(
        input,
        reusableCache,
        useCache && mode === "manual" ? "skipped-fresh" : undefined,
      );
    if (useCache && projectedFromCache) return;
    if (!projectedFromCache) set(EMPTY_PROJECTION);

    if (!useOfflineStore.getState().isConnected) {
      // A stale forecast remains useful offline, but its projection belongs to
      // today's route/ETA. Keep it visible with the existing offline status.
      set({ lastAttemptedAtMs: Date.now() });
      recordFailure("Offline");
      return;
    }

    set({ fetchStatus: "fetching", lastAttemptedAtMs: Date.now(), lastError: null });
    // ETA/stop edits can share a download only when its requested time horizon
    // still fits. Only the latest projection may publish or persist.
    const forecastRequestKey = JSON.stringify([
      context.routeId,
      context.geometryKey,
      Math.round(context.fromDistanceAlongRouteMeters / 100),
      context.plannedStartMs,
      requirements?.forecastHours,
    ]);
    let request = pendingForecasts.get(forecastRequestKey);
    if (!request) {
      request = fetchWeatherForecastsForRoute(
        points,
        context.fromDistanceAlongRouteMeters,
        cumulativeTime,
        options,
      ).then((forecasts) => ({
        routeId: context.routeId,
        geometryKey: context.geometryKey,
        fromDistanceAlongRouteMeters: context.fromDistanceAlongRouteMeters,
        forecasts,
        fetchedAt: Date.now(),
      }));
      pendingForecasts.set(forecastRequestKey, request);
    }
    try {
      const cache = await request;
      if (requestGeneration !== generation) return;
      if (cache.forecasts.length === 0) throw new Error("No weather forecasts returned");
      if (!publishProjection(input, cache, mode === "manual" ? "success" : undefined)) {
        throw new Error("No forecast coverage for route");
      }
      forecastCache = cache;
      persistCache(cache);
    } catch (error) {
      if (requestGeneration !== generation) return;
      recordFailure(error instanceof Error ? error.message : "Failed to fetch weather");
    } finally {
      if (pendingForecasts.get(forecastRequestKey) === request) {
        pendingForecasts.delete(forecastRequestKey);
      }
    }
  }

  return {
    ...EMPTY_PROJECTION,
    requestContext: null,
    fetchStatus: "idle",
    lastFailedFetchAtMs: null,
    lastAttemptedAtMs: null,
    lastError: null,
    lastRefreshOutcome: "idle",
    lastRefreshMessage: null,
    fetchWeather: (...args) => runFetch(createWeatherProjectionInput(...args), "automatic"),
    refreshWeatherNow: (...args) => runFetch(createWeatherProjectionInput(...args), "manual"),
    recordManualRefreshUnavailable: (message = "Weather refresh unavailable") => {
      set({ lastRefreshOutcome: "unavailable", lastRefreshMessage: message });
    },
    clearWeather: () => {
      generation += 1;
      forecastCache = null;
      pendingForecasts.clear();
      persistCache(null);
      set({
        ...EMPTY_PROJECTION,
        requestContext: null,
        fetchStatus: "idle",
        lastFailedFetchAtMs: null,
        lastAttemptedAtMs: null,
        lastError: null,
        lastRefreshOutcome: "idle",
        lastRefreshMessage: null,
      });
    },
  };
});
