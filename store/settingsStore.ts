import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { UnitSystem, WeatherTemperatureDisplayMode, WeatherTimelineMetricKey } from "@/types";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "settings" });
  }
  return storage;
}

function readString(key: string): string | undefined {
  try {
    return getStorage().getString(key);
  } catch {
    return undefined;
  }
}

const DEFAULT_WEATHER_TIMELINE_METRICS: WeatherTimelineMetricKey[] = ["precipitation", "gusts"];

function isWeatherTimelineMetricKey(value: unknown): value is WeatherTimelineMetricKey {
  return value === "precipitation" || value === "humidity" || value === "gusts";
}

function normalizeWeatherTimelineMetrics(metrics: unknown): WeatherTimelineMetricKey[] {
  if (!Array.isArray(metrics)) return DEFAULT_WEATHER_TIMELINE_METRICS;

  const deduped = Array.from(new Set(metrics.filter(isWeatherTimelineMetricKey)));
  return deduped.length > 0 ? deduped : DEFAULT_WEATHER_TIMELINE_METRICS;
}

function readWeatherTimelineMetrics(): WeatherTimelineMetricKey[] {
  const raw = readString("weatherTimelineMetrics");
  if (!raw) return DEFAULT_WEATHER_TIMELINE_METRICS;

  try {
    return normalizeWeatherTimelineMetrics(JSON.parse(raw));
  } catch {
    return DEFAULT_WEATHER_TIMELINE_METRICS;
  }
}

interface SettingsState {
  units: UnitSystem;
  weatherTemperatureDisplayMode: WeatherTemperatureDisplayMode;
  weatherTimelineMetrics: WeatherTimelineMetricKey[];
  setUnits: (units: UnitSystem) => void;
  setWeatherTemperatureDisplayMode: (mode: WeatherTemperatureDisplayMode) => void;
  setWeatherTimelineMetrics: (metrics: WeatherTimelineMetricKey[]) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  units: (readString("units") as UnitSystem) ?? "metric",
  weatherTemperatureDisplayMode:
    (readString("weatherTemperatureDisplayMode") as WeatherTemperatureDisplayMode) ?? "actual",
  weatherTimelineMetrics: readWeatherTimelineMetrics(),

  setUnits: (units) => {
    try {
      getStorage().set("units", units);
    } catch {}
    set({ units });
  },

  setWeatherTemperatureDisplayMode: (weatherTemperatureDisplayMode) => {
    try {
      getStorage().set("weatherTemperatureDisplayMode", weatherTemperatureDisplayMode);
    } catch {}
    set({ weatherTemperatureDisplayMode });
  },

  setWeatherTimelineMetrics: (metrics) => {
    const weatherTimelineMetrics = normalizeWeatherTimelineMetrics(metrics);
    try {
      getStorage().set("weatherTimelineMetrics", JSON.stringify(weatherTimelineMetrics));
    } catch {}
    set({ weatherTimelineMetrics });
  },
}));
