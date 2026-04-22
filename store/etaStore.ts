import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { PowerModelConfig, ETAResult, RoutePoint, POI } from "@/types";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { computeRouteETA, getETAToDistance } from "@/services/etaCalculator";
import { useRouteStore } from "./routeStore";
import { useCollectionStore } from "./collectionStore";
import { usePoiStore } from "./poiStore";

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

  getETAToPOI: (poi: POI) => ETAResult | null;
  getETAToDistance: (distAlongRouteM: number) => ETAResult | null;
  _resolveETA: (targetDistM: number) => ETAResult | null;
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
    // Canonicalize the distance: look up the raw POI from the store so we
    // don't double-apply the offset when a caller passes a POI that's
    // already been rewritten by stitchPOIs.
    const rawPoi = usePoiStore.getState().pois[poi.routeId]?.find((p) => p.id === poi.id);
    let targetDist = (rawPoi ?? poi).distanceAlongRouteMeters;

    // If the active context is a stitched collection, shift the POI into
    // stitched coords so it aligns with cumulativeTime / snapped pointIndex.
    const stitched = useCollectionStore.getState().activeStitchedCollection;
    if (stitched && stitched.collectionId === get().routeId) {
      const seg = stitched.segments.find((s) => s.routeId === poi.routeId);
      if (seg) targetDist += seg.distanceOffsetMeters;
    }

    return get()._resolveETA(targetDist);
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
