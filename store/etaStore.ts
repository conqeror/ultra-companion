import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type {
  PowerModelConfig,
  ETAResult,
  RoutePoint,
  DisplayDistanceMeters,
  DisplayPOI,
} from "@/types";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { computeRouteETA, getETAToDistance } from "@/services/etaCalculator";
import { toDisplayPOIForSegments } from "@/services/displayDistance";
import { useRouteStore } from "./routeStore";
import { useCollectionStore } from "./collectionStore";

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
  cachedPoints: RoutePoint[] | null;

  updatePowerConfig: (partial: Partial<PowerModelConfig>) => void;
  computeETAForRoute: (routeId: string, points: RoutePoint[]) => void;
  invalidateCache: () => void;

  getETAToPOI: (poi: DisplayPOI) => ETAResult | null;
  getETAToDistance: (distAlongRouteM: DisplayDistanceMeters) => ETAResult | null;
  _resolveETA: (targetDistM: DisplayDistanceMeters) => ETAResult | null;
}

export const useEtaStore = create<ETAState>((set, get) => ({
  powerConfig: loadConfig(),
  cumulativeTime: null,
  routeId: null,
  cachedPoints: null,

  updatePowerConfig: (partial) => {
    const next = { ...get().powerConfig, ...partial };
    try {
      getStorage().set("powerConfig", JSON.stringify(next));
    } catch {}
    set({ powerConfig: next, cumulativeTime: null, routeId: null, cachedPoints: null });
  },

  computeETAForRoute: (routeId, points) => {
    // Skip if the exact same points array was already used for this route.
    // Reference equality handles variant swaps within a collection: same id,
    // different points array → fresh compute.
    if (get().routeId === routeId && get().cachedPoints === points && get().cumulativeTime) {
      return;
    }
    const cumulative = computeRouteETA(points, get().powerConfig);
    set({ cumulativeTime: cumulative, routeId, cachedPoints: points });
  },

  invalidateCache: () => {
    set({ cumulativeTime: null, routeId: null, cachedPoints: null });
  },

  getETAToPOI: (poi) => {
    const stitched = useCollectionStore.getState().activeStitchedCollection;
    const segments = stitched && stitched.collectionId === get().routeId ? stitched.segments : null;
    const displayPOI = toDisplayPOIForSegments(poi, segments);
    if (!displayPOI) return null;

    return get()._resolveETA(displayPOI.effectiveDistanceMeters);
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
