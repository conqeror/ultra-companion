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
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import { computeRouteETA, getETAToDistanceFromDistance } from "@/services/etaCalculator";
import { toDisplayPOIForSegments } from "@/services/displayDistance";
import { futureStartMs } from "@/utils/activeRouteTiming";
import {
  applyPlannedStopOffsetToETA,
  plannedStopOffsetSecondsBeforeDistance,
  plannedStopsFromPOIs,
} from "@/services/plannedStops";
import { resolveRouteProgress } from "@/utils/routeProgress";
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

function plannedStartForRoute(routeId: string): number | null {
  const collectionState = useCollectionStore.getState();
  const stitched = collectionState.activeStitchedCollection;
  if (stitched?.collectionId !== routeId) return null;
  const collection = collectionState.collections.find((c) => c.id === routeId);
  return collection?.plannedStartMs ?? null;
}

function plannedStopsForRoute(routeId: string) {
  const poiState = usePoiStore.getState();
  const collectionState = useCollectionStore.getState();
  const stitched = collectionState.activeStitchedCollection;

  if (stitched?.collectionId === routeId) {
    return plannedStopsFromPOIs(
      displayPOIsForActiveRoute(
        stitched.segments.map((segment) => segment.routeId),
        stitched.segments,
        poiState.pois,
      ),
    );
  }

  return plannedStopsFromPOIs(displayPOIsForActiveRoute([routeId], null, poiState.pois));
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
    const { cumulativeTime, routeId, cachedPoints } = get();
    if (!cumulativeTime || !routeId) return null;

    const snapped = useRouteStore.getState().snappedPosition;
    const routePoints = cachedPoints ?? useRouteStore.getState().visibleRoutePoints[routeId];
    if (!routePoints?.length) return null;
    const plannedStartMs = plannedStartForRoute(routeId);
    const routeProgress = resolveRouteProgress(snapped, routeId, routePoints, { plannedStartMs });
    if (!routeProgress) return null;

    const result = getETAToDistanceFromDistance(
      cumulativeTime,
      routePoints,
      routeProgress.distanceAlongRouteMeters,
      targetDistM,
    );
    if (!result) return null;

    const etaStartMs = futureStartMs(plannedStartMs);
    const stopOffsetSeconds = plannedStopOffsetSecondsBeforeDistance(
      plannedStopsForRoute(routeId),
      routeProgress.distanceAlongRouteMeters,
      targetDistM,
    );
    const withStops = applyPlannedStopOffsetToETA(result, stopOffsetSeconds, etaStartMs);
    if (!withStops) return null;

    if (etaStartMs != null) {
      return {
        ...withStops,
        eta: new Date(etaStartMs + withStops.ridingTimeSeconds * 1000),
      };
    }

    return withStops;
  },
}));
