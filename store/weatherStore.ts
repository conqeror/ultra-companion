import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { WeatherPoint, WeatherFetchStatus, RoutePoint } from "@/types";
import { WEATHER_STALE_MS } from "@/constants";
import { buildWeatherTimeline } from "@/services/weatherService";
import { useOfflineStore } from "./offlineStore";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "weather" });
  }
  return storage;
}

interface CachedWeather {
  timeline: WeatherPoint[];
  fetchedAt: number;
  routeId: string;
}

function loadCache(): CachedWeather | null {
  try {
    const raw = getStorage().getString("cache");
    if (raw) return JSON.parse(raw);
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

interface WeatherState {
  timeline: WeatherPoint[];
  fetchedAt: number | null;
  routeId: string | null;
  fetchStatus: WeatherFetchStatus;
  error: string | null;

  fetchWeather: (
    routeId: string,
    points: RoutePoint[],
    fromIndex: number,
    cumulativeTime: number[],
  ) => Promise<void>;
  clearWeather: () => void;
}

export const useWeatherStore = create<WeatherState>((set, get) => {
  const cached = loadCache();
  // Mark cached data as stale if older than threshold
  const cacheIsFresh = cached?.fetchedAt && Date.now() - cached.fetchedAt < WEATHER_STALE_MS;

  return {
    timeline: cached?.timeline ?? [],
    fetchedAt: cached?.fetchedAt ?? null,
    routeId: cached?.routeId ?? null,
    fetchStatus: cacheIsFresh && cached?.timeline?.length ? "done" : "idle",
    error: null,

    fetchWeather: async (routeId, points, fromIndex, cumulativeTime) => {
      const state = get();

      // Skip if already fetching
      if (state.fetchStatus === "fetching") return;

      const isConnected = useOfflineStore.getState().isConnected;
      if (!isConnected) return;

      // Don't refetch if we have fresh data for the same route
      if (
        state.routeId === routeId &&
        state.fetchedAt &&
        Date.now() - state.fetchedAt < WEATHER_STALE_MS &&
        state.timeline.length > 0
      ) {
        return;
      }

      set({ fetchStatus: "fetching", error: null });

      try {
        const timeline = await buildWeatherTimeline(points, fromIndex, cumulativeTime);

        const cache: CachedWeather = {
          timeline,
          fetchedAt: Date.now(),
          routeId,
        };
        persistCache(cache);

        set({
          timeline,
          fetchedAt: cache.fetchedAt,
          routeId,
          fetchStatus: "done",
          error: null,
        });
      } catch (e) {
        set({
          fetchStatus: "error",
          error: e instanceof Error ? e.message : "Failed to fetch weather",
        });
      }
    },

    clearWeather: () => {
      clearCache();
      set({
        timeline: [],
        fetchedAt: null,
        routeId: null,
        fetchStatus: "idle",
        error: null,
      });
    },
  };
});
