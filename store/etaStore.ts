import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { PowerModelConfig, ETAResult, RoutePoint, POI } from "@/types";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { computeRouteETA, getETAToDistance } from "@/services/etaCalculator";
import { useRouteStore } from "./routeStore";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "eta" });
  }
  return storage;
}

function loadConfig(): PowerModelConfig {
  try {
    const raw = getStorage().getString("powerConfig");
    if (raw) return { ...DEFAULT_POWER_CONFIG, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_POWER_CONFIG;
}

interface ETAState {
  powerConfig: PowerModelConfig;
  cumulativeTime: number[] | null;
  routeId: string | null;

  updatePowerConfig: (partial: Partial<PowerModelConfig>) => void;
  computeETAForRoute: (routeId: string, points: RoutePoint[]) => void;
  invalidateCache: () => void;

  getETAToPOI: (poi: POI) => ETAResult | null;
  getETAToDistance: (distAlongRouteM: number) => ETAResult | null;
  _resolveETA: (targetDistM: number) => ETAResult | null;
}

export const useEtaStore = create<ETAState>((set, get) => ({
  powerConfig: loadConfig(),
  cumulativeTime: null,
  routeId: null,

  updatePowerConfig: (partial) => {
    const next = { ...get().powerConfig, ...partial };
    try { getStorage().set("powerConfig", JSON.stringify(next)); } catch {}
    set({ powerConfig: next, cumulativeTime: null, routeId: null });
  },

  computeETAForRoute: (routeId, points) => {
    // Skip if already computed for this route
    if (get().routeId === routeId && get().cumulativeTime) return;
    const cumulative = computeRouteETA(points, get().powerConfig);
    set({ cumulativeTime: cumulative, routeId });
  },

  invalidateCache: () => {
    set({ cumulativeTime: null, routeId: null });
  },

  getETAToPOI: (poi) => {
    return get()._resolveETA(poi.distanceAlongRouteMeters);
  },

  getETAToDistance: (distAlongRouteM) => {
    return get()._resolveETA(distAlongRouteM);
  },

  _resolveETA: (targetDistM) => {
    const { cumulativeTime, routeId } = get();
    if (!cumulativeTime || !routeId) return null;

    const snapped = useRouteStore.getState().snappedPosition;
    if (!snapped) return null;

    const routePoints = useRouteStore.getState().visibleRoutePoints[routeId];
    if (!routePoints?.length) return null;

    return getETAToDistance(cumulativeTime, routePoints, snapped.pointIndex, targetDistM);
  },
}));
