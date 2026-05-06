import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { RoutePoint, WeatherFetchStatus, WeatherPoint } from "@/types";
import { WEATHER_MANUAL_REFRESH_THROTTLE_MS, WEATHER_STALE_MS } from "@/constants";
import {
  buildWeatherTimelineFromForecasts,
  fetchWeatherForecastsForRoute,
} from "@/services/weatherService";
import type { HourlyForecast } from "@/services/weatherClient";
import type { PlannedStop } from "@/services/plannedStops";
import { useOfflineStore } from "./offlineStore";

let storage: MMKV | null = null;
const WEATHER_CACHE_VERSION = 3;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "weather" });
  }
  return storage;
}

export type WeatherManualRefreshOutcome =
  | "idle"
  | "unavailable"
  | "skipped-fresh"
  | "success"
  | "error";

interface CachedWeather {
  version: number;
  timeline: WeatherPoint[];
  forecasts: HourlyForecast[];
  fetchedAt: number;
  routeId: string;
  plannedStartMs: number | null;
  plannedStopSignature: string;
  fromDistanceAlongRouteMeters: number;
  forecastFromMs: number | null;
  forecastUntilMs: number | null;
  routeCoverageFromMeters: number | null;
  routeCoverageUntilMeters: number | null;
}

function loadCache(): CachedWeather | null {
  try {
    const raw = getStorage().getString("cache");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CachedWeather>;
    if (parsed.version !== WEATHER_CACHE_VERSION) return null;
    if (!Array.isArray(parsed.timeline)) return null;
    if (!Array.isArray(parsed.forecasts)) return null;
    return parsed as CachedWeather;
  } catch {}
  return null;
}

function persistCache(cache: CachedWeather): void {
  try {
    getStorage().set("cache", JSON.stringify(cache));
  } catch {}
}

function clearCache(): void {
  try {
    getStorage().set("cache", "");
  } catch {}
}

function isFresh(fetchAt: number | null): boolean {
  return fetchAt != null && Date.now() - fetchAt < WEATHER_STALE_MS;
}

function plannedStopSignature(plannedStops: readonly PlannedStop[] | null | undefined): string {
  if (!plannedStops?.length) return "none";
  return plannedStops
    .map((stop) => `${Math.round(stop.distanceMeters)}:${stop.durationSeconds}`)
    .join(",");
}

function contextKey(
  routeId: string,
  plannedStartMs: number | null,
  fromDistanceMeters: number,
  stopSignature: string,
) {
  return `${routeId}:${plannedStartMs ?? "now"}:${Math.round(fromDistanceMeters / 100)}:${stopSignature}`;
}

function cacheMatchesContext(
  cache: CachedWeather | null,
  routeId: string,
  plannedStartMs: number | null,
  fromDistanceMeters: number,
  stopSignature: string,
): boolean {
  return (
    cache?.routeId === routeId &&
    cache.plannedStartMs === plannedStartMs &&
    cache.plannedStopSignature === stopSignature &&
    Math.abs(cache.fromDistanceAlongRouteMeters - fromDistanceMeters) < 100
  );
}

function cacheMatchesRouteStart(
  cache: CachedWeather | null,
  routeId: string,
  plannedStartMs: number | null,
): cache is CachedWeather {
  return cache?.routeId === routeId && cache.plannedStartMs === plannedStartMs;
}

function rebuildCachedWeather(
  cache: CachedWeather,
  points: RoutePoint[],
  fromDistanceAlongRouteMeters: number,
  cumulativeTime: number[],
  plannedStartMs: number | null,
  plannedStops: readonly PlannedStop[],
  stopSignature: string,
): CachedWeather | null {
  const options = {
    ...(plannedStartMs ? { projectionStartTime: new Date(plannedStartMs) } : {}),
    plannedStops,
  };
  const buildResult = buildWeatherTimelineFromForecasts(
    points,
    fromDistanceAlongRouteMeters,
    cumulativeTime,
    cache.forecasts,
    options,
  );
  if (buildResult.timeline.length === 0) return null;
  return {
    ...cache,
    timeline: buildResult.timeline,
    plannedStopSignature: stopSignature,
    fromDistanceAlongRouteMeters,
    forecastFromMs: buildResult.forecastFromMs,
    forecastUntilMs: buildResult.forecastUntilMs,
    routeCoverageFromMeters: buildResult.routeCoverageFromMeters,
    routeCoverageUntilMeters: buildResult.routeCoverageUntilMeters,
  };
}

interface WeatherState {
  timeline: WeatherPoint[];
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
  refreshWeatherNow: (
    routeId: string,
    points: RoutePoint[],
    fromDistanceAlongRouteMeters: number,
    cumulativeTime: number[],
    plannedStartMs?: number | null,
    plannedStops?: readonly PlannedStop[],
  ) => Promise<void>;
  recordManualRefreshUnavailable: (message?: string) => void;
  clearWeather: () => void;
}

export const useWeatherStore = create<WeatherState>((set, get) => {
  const cached = loadCache();
  const hasCachedTimeline = (cached?.timeline.length ?? 0) > 0;

  async function runFetch(
    routeId: string,
    points: RoutePoint[],
    fromDistanceAlongRouteMeters: number,
    cumulativeTime: number[],
    mode: "automatic" | "manual",
    plannedStartMs: number | null = null,
    plannedStops: readonly PlannedStop[] = [],
  ): Promise<void> {
    const state = get();
    if (state.fetchStatus === "fetching") {
      if (mode === "manual") {
        set({
          lastRefreshOutcome: "unavailable",
          lastRefreshMessage: "Weather refresh already in progress",
        });
      }
      return;
    }

    const stopSignature = plannedStopSignature(plannedStops);
    const currentContextKey = contextKey(
      routeId,
      plannedStartMs,
      fromDistanceAlongRouteMeters,
      stopSignature,
    );
    const cachedData = loadCache();

    if (
      mode === "automatic" &&
      state.timeline.length > 0 &&
      state.routeId != null &&
      contextKey(
        state.routeId,
        state.plannedStartMs,
        state.fromDistanceAlongRouteMeters ?? 0,
        state.plannedStopSignature,
      ) === currentContextKey &&
      isFresh(state.lastSuccessfulFetchAtMs)
    ) {
      return;
    }

    if (
      mode === "automatic" &&
      cacheMatchesContext(
        cachedData,
        routeId,
        plannedStartMs,
        fromDistanceAlongRouteMeters,
        stopSignature,
      ) &&
      isFresh(cachedData?.fetchedAt ?? null)
    ) {
      set({
        timeline: cachedData?.timeline ?? [],
        fetchStatus: "done",
        lastSuccessfulFetchAtMs: cachedData?.fetchedAt ?? null,
        lastFailedFetchAtMs: null,
        lastError: null,
        forecastFromMs: cachedData?.forecastFromMs ?? null,
        forecastUntilMs: cachedData?.forecastUntilMs ?? null,
        routeCoverageFromMeters: cachedData?.routeCoverageFromMeters ?? null,
        routeCoverageUntilMeters: cachedData?.routeCoverageUntilMeters ?? null,
        routeId,
        plannedStartMs,
        plannedStopSignature: stopSignature,
        fromDistanceAlongRouteMeters,
      });
      return;
    }

    if (
      mode === "automatic" &&
      cacheMatchesRouteStart(cachedData, routeId, plannedStartMs) &&
      isFresh(cachedData.fetchedAt)
    ) {
      const rebuiltCache = rebuildCachedWeather(
        cachedData,
        points,
        fromDistanceAlongRouteMeters,
        cumulativeTime,
        plannedStartMs,
        plannedStops,
        stopSignature,
      );
      if (rebuiltCache) {
        persistCache(rebuiltCache);
        set({
          timeline: rebuiltCache.timeline,
          fetchStatus: "done",
          lastSuccessfulFetchAtMs: rebuiltCache.fetchedAt,
          lastFailedFetchAtMs: null,
          lastError: null,
          forecastFromMs: rebuiltCache.forecastFromMs,
          forecastUntilMs: rebuiltCache.forecastUntilMs,
          routeCoverageFromMeters: rebuiltCache.routeCoverageFromMeters,
          routeCoverageUntilMeters: rebuiltCache.routeCoverageUntilMeters,
          routeId,
          plannedStartMs,
          plannedStopSignature: stopSignature,
          fromDistanceAlongRouteMeters,
        });
        return;
      }
    }

    if (
      mode === "manual" &&
      cacheMatchesContext(
        cachedData,
        routeId,
        plannedStartMs,
        fromDistanceAlongRouteMeters,
        stopSignature,
      ) &&
      isFresh(cachedData?.fetchedAt ?? null) &&
      state.lastSuccessfulFetchAtMs != null &&
      Date.now() - state.lastSuccessfulFetchAtMs < WEATHER_MANUAL_REFRESH_THROTTLE_MS
    ) {
      set({
        timeline: cachedData?.timeline ?? state.timeline,
        fetchStatus: "done",
        lastSuccessfulFetchAtMs: cachedData?.fetchedAt ?? state.lastSuccessfulFetchAtMs,
        lastFailedFetchAtMs: null,
        lastError: null,
        lastRefreshOutcome: "skipped-fresh",
        lastRefreshMessage: "Already up to date",
        forecastFromMs: cachedData?.forecastFromMs ?? state.forecastFromMs,
        forecastUntilMs: cachedData?.forecastUntilMs ?? state.forecastUntilMs,
        routeCoverageFromMeters:
          cachedData?.routeCoverageFromMeters ?? state.routeCoverageFromMeters,
        routeCoverageUntilMeters:
          cachedData?.routeCoverageUntilMeters ?? state.routeCoverageUntilMeters,
        routeId,
        plannedStartMs,
        plannedStopSignature: stopSignature,
        fromDistanceAlongRouteMeters,
      });
      return;
    }

    const attemptedAt = Date.now();
    set({
      fetchStatus: "fetching",
      lastAttemptedAtMs: attemptedAt,
      lastError: null,
      ...(mode === "manual"
        ? {
            lastRefreshOutcome: "idle" as const,
            lastRefreshMessage: null,
          }
        : {}),
    });

    if (!useOfflineStore.getState().isConnected) {
      set({
        fetchStatus: "error",
        lastFailedFetchAtMs: attemptedAt,
        lastError: "Offline",
        lastRefreshOutcome: "error",
        lastRefreshMessage: "Offline",
      });
      return;
    }

    try {
      const options = {
        ...(plannedStartMs ? { projectionStartTime: new Date(plannedStartMs) } : {}),
        plannedStops,
      };
      const forecasts = await fetchWeatherForecastsForRoute(
        points,
        fromDistanceAlongRouteMeters,
        cumulativeTime,
        options,
      );
      if (forecasts.length === 0) throw new Error("No weather forecasts returned");

      const buildResult = buildWeatherTimelineFromForecasts(
        points,
        fromDistanceAlongRouteMeters,
        cumulativeTime,
        forecasts,
        options,
      );
      if (buildResult.timeline.length === 0) throw new Error("No forecast coverage for route");

      const fetchedAt = Date.now();
      const cache: CachedWeather = {
        version: WEATHER_CACHE_VERSION,
        timeline: buildResult.timeline,
        forecasts,
        fetchedAt,
        routeId,
        plannedStartMs,
        plannedStopSignature: stopSignature,
        fromDistanceAlongRouteMeters,
        forecastFromMs: buildResult.forecastFromMs,
        forecastUntilMs: buildResult.forecastUntilMs,
        routeCoverageFromMeters: buildResult.routeCoverageFromMeters,
        routeCoverageUntilMeters: buildResult.routeCoverageUntilMeters,
      };
      persistCache(cache);

      set({
        timeline: buildResult.timeline,
        fetchStatus: "done",
        lastSuccessfulFetchAtMs: fetchedAt,
        lastFailedFetchAtMs: null,
        lastAttemptedAtMs: attemptedAt,
        lastError: null,
        lastRefreshOutcome: mode === "manual" ? "success" : get().lastRefreshOutcome,
        lastRefreshMessage: mode === "manual" ? null : get().lastRefreshMessage,
        forecastFromMs: buildResult.forecastFromMs,
        forecastUntilMs: buildResult.forecastUntilMs,
        routeCoverageFromMeters: buildResult.routeCoverageFromMeters,
        routeCoverageUntilMeters: buildResult.routeCoverageUntilMeters,
        routeId,
        plannedStartMs,
        fromDistanceAlongRouteMeters,
      });
    } catch (e) {
      const failedAt = Date.now();
      const message = e instanceof Error ? e.message : "Failed to fetch weather";
      set({
        fetchStatus: "error",
        lastFailedFetchAtMs: failedAt,
        lastError: message,
        lastRefreshOutcome: "error",
        lastRefreshMessage: message,
      });
    }
  }

  return {
    timeline: hasCachedTimeline ? (cached?.timeline ?? []) : [],
    fetchStatus: hasCachedTimeline ? "done" : "idle",
    lastSuccessfulFetchAtMs: hasCachedTimeline ? (cached?.fetchedAt ?? null) : null,
    lastFailedFetchAtMs: null,
    lastAttemptedAtMs: null,
    lastError: null,
    lastRefreshOutcome: "idle",
    lastRefreshMessage: null,
    forecastFromMs: hasCachedTimeline ? (cached?.forecastFromMs ?? null) : null,
    forecastUntilMs: hasCachedTimeline ? (cached?.forecastUntilMs ?? null) : null,
    routeCoverageFromMeters: hasCachedTimeline ? (cached?.routeCoverageFromMeters ?? null) : null,
    routeCoverageUntilMeters: hasCachedTimeline ? (cached?.routeCoverageUntilMeters ?? null) : null,
    routeId: hasCachedTimeline ? (cached?.routeId ?? null) : null,
    plannedStartMs: hasCachedTimeline ? (cached?.plannedStartMs ?? null) : null,
    plannedStopSignature: hasCachedTimeline ? (cached?.plannedStopSignature ?? "none") : "none",
    fromDistanceAlongRouteMeters: hasCachedTimeline
      ? (cached?.fromDistanceAlongRouteMeters ?? null)
      : null,

    fetchWeather: async (
      routeId,
      points,
      fromDistanceAlongRouteMeters,
      cumulativeTime,
      plannedStartMs = null,
      plannedStops = [],
    ) => {
      await runFetch(
        routeId,
        points,
        fromDistanceAlongRouteMeters,
        cumulativeTime,
        "automatic",
        plannedStartMs,
        plannedStops,
      );
    },

    refreshWeatherNow: async (
      routeId,
      points,
      fromDistanceAlongRouteMeters,
      cumulativeTime,
      plannedStartMs = null,
      plannedStops = [],
    ) => {
      await runFetch(
        routeId,
        points,
        fromDistanceAlongRouteMeters,
        cumulativeTime,
        "manual",
        plannedStartMs,
        plannedStops,
      );
    },

    recordManualRefreshUnavailable: (message = "Weather refresh unavailable") => {
      set({
        lastRefreshOutcome: "unavailable",
        lastRefreshMessage: message,
      });
    },

    clearWeather: () => {
      clearCache();
      set({
        timeline: [],
        fetchStatus: "idle",
        lastSuccessfulFetchAtMs: null,
        lastFailedFetchAtMs: null,
        lastAttemptedAtMs: null,
        lastError: null,
        lastRefreshOutcome: "idle",
        lastRefreshMessage: null,
        forecastFromMs: null,
        forecastUntilMs: null,
        routeCoverageFromMeters: null,
        routeCoverageUntilMeters: null,
        routeId: null,
        plannedStartMs: null,
        plannedStopSignature: "none",
        fromDistanceAlongRouteMeters: null,
      });
    },
  };
});
