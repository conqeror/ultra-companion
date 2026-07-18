import { create } from "zustand";
import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import type {
  PowerModelConfig,
  ETAResult,
  RoutePoint,
  DisplayDistanceMeters,
  DisplayPOI,
  RelativeETAProgress,
  RelativeETAStatus,
  RelativeETAScope,
} from "@/types";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { displayPOIsForActiveRoute } from "@/services/activePOIs";
import { computeCachedRouteETA, getETAToDistanceFromDistance } from "@/services/etaCalculator";
import {
  buildRelativeETACacheDescriptor,
  clearRelativeETACaches as clearPersistentRelativeETACaches,
  computeRouteETAInChunks,
  loadRelativeETACache,
  persistRelativeETACache,
  type RelativeETAInput,
} from "@/services/relativeEtaCache";
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
import type { FerryTimingCrossing } from "@/services/ferryCrossings";

let storage: KeyValueStorage | null = null;
const relativeETAJobs = new Map<string, Promise<number[] | null>>();

interface RelativeETACacheState {
  scope: RelativeETAScope;
  scopeId: string;
  status: RelativeETAStatus;
  progress: RelativeETAProgress | null;
  error: string | null;
}

function getStorage(): KeyValueStorage {
  if (!storage) {
    storage = createKeyValueStorage("eta");
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Failed to calculate ETA";
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
  cachedFerries: readonly FerryTimingCrossing[];
  activeCacheKey: string | null;
  etaStatus: RelativeETAStatus;
  etaProgress: RelativeETAProgress | null;
  etaError: string | null;
  cacheStates: Record<string, RelativeETACacheState>;

  updatePowerConfig: (partial: Partial<PowerModelConfig>) => void;
  computeETAForRoute: (routeId: string, points: RoutePoint[]) => void;
  ensureRelativeETA: (input: RelativeETAInput) => Promise<number[] | null>;
  prewarmRelativeETA: (input: RelativeETAInput) => void;
  clearRelativeETACache: (scopeId?: string) => Promise<void>;
  invalidateCache: () => void;

  getETAToPOI: (poi: DisplayPOI) => ETAResult | null;
  getETAToDistance: (distAlongRouteM: DisplayDistanceMeters) => ETAResult | null;
  resolveETA: (targetDistM: DisplayDistanceMeters) => ETAResult | null;
}

export const useEtaStore = create<ETAState>((set, get) => {
  const setCacheState = (
    cacheKey: string,
    next: Partial<RelativeETACacheState> & Pick<RelativeETACacheState, "scope" | "scopeId">,
  ) => {
    set((state) => ({
      cacheStates: {
        ...state.cacheStates,
        [cacheKey]: {
          scope: next.scope,
          scopeId: next.scopeId,
          status: next.status ?? state.cacheStates[cacheKey]?.status ?? "idle",
          progress:
            next.progress === undefined
              ? (state.cacheStates[cacheKey]?.progress ?? null)
              : next.progress,
          error:
            next.error === undefined ? (state.cacheStates[cacheKey]?.error ?? null) : next.error,
        },
      },
    }));
  };

  const ensure = async (
    input: RelativeETAInput,
    options: { publishActive: boolean },
  ): Promise<number[] | null> => {
    const powerConfig = get().powerConfig;
    const descriptor = buildRelativeETACacheDescriptor(input, powerConfig);
    const current = get();
    const isAlreadyReady =
      current.activeCacheKey === descriptor.cacheKey &&
      current.cachedPoints === input.points &&
      current.cumulativeTime?.length === input.points.length &&
      current.etaStatus === "ready";

    if (options.publishActive && isAlreadyReady) return current.cumulativeTime;

    if (options.publishActive) {
      set({
        activeCacheKey: descriptor.cacheKey,
        etaStatus: "loading",
        etaProgress: null,
        etaError: null,
        cumulativeTime: null,
        routeId: input.scopeId,
        cachedPoints: input.points,
        cachedFerries: input.ferries ?? [],
      });
    }
    setCacheState(descriptor.cacheKey, {
      scope: descriptor.scope,
      scopeId: descriptor.scopeId,
      status: "loading",
      progress: null,
      error: null,
    });

    try {
      const cached = await loadRelativeETACache(descriptor);
      if (cached) {
        setCacheState(descriptor.cacheKey, {
          scope: descriptor.scope,
          scopeId: descriptor.scopeId,
          status: "ready",
          progress: { computedPoints: descriptor.pointCount, totalPoints: descriptor.pointCount },
          error: null,
        });
        if (options.publishActive && get().activeCacheKey === descriptor.cacheKey) {
          set({
            cumulativeTime: cached,
            routeId: input.scopeId,
            cachedPoints: input.points,
            cachedFerries: input.ferries ?? [],
            etaStatus: "ready",
            etaProgress: {
              computedPoints: descriptor.pointCount,
              totalPoints: descriptor.pointCount,
            },
            etaError: null,
          });
        }
        return cached;
      }

      const progressHandler = (progress: RelativeETAProgress) => {
        setCacheState(descriptor.cacheKey, {
          scope: descriptor.scope,
          scopeId: descriptor.scopeId,
          status: "computing",
          progress,
          error: null,
        });
        if (options.publishActive && get().activeCacheKey === descriptor.cacheKey) {
          set({ etaStatus: "computing", etaProgress: progress, etaError: null });
        }
      };

      let job = relativeETAJobs.get(descriptor.cacheKey);
      if (!job) {
        job = (async () => {
          const computed = await computeRouteETAInChunks(input.points, powerConfig, {
            onProgress: progressHandler,
            ferries: input.ferries,
          });
          await persistRelativeETACache(descriptor, computed);
          return computed;
        })()
          .catch((error) => {
            console.warn("Failed to compute relative ETA cache:", error);
            throw error;
          })
          .finally(() => {
            relativeETAJobs.delete(descriptor.cacheKey);
          });
        relativeETAJobs.set(descriptor.cacheKey, job);
      } else {
        setCacheState(descriptor.cacheKey, {
          scope: descriptor.scope,
          scopeId: descriptor.scopeId,
          status: "computing",
          progress: get().cacheStates[descriptor.cacheKey]?.progress ?? null,
          error: null,
        });
        if (options.publishActive && get().activeCacheKey === descriptor.cacheKey) {
          set({
            etaStatus: "computing",
            etaProgress: get().cacheStates[descriptor.cacheKey]?.progress ?? null,
            etaError: null,
          });
        }
      }

      const computed = await job;
      setCacheState(descriptor.cacheKey, {
        scope: descriptor.scope,
        scopeId: descriptor.scopeId,
        status: "ready",
        progress: { computedPoints: descriptor.pointCount, totalPoints: descriptor.pointCount },
        error: null,
      });
      if (options.publishActive && get().activeCacheKey === descriptor.cacheKey) {
        set({
          cumulativeTime: computed,
          routeId: input.scopeId,
          cachedPoints: input.points,
          cachedFerries: input.ferries ?? [],
          etaStatus: "ready",
          etaProgress: {
            computedPoints: descriptor.pointCount,
            totalPoints: descriptor.pointCount,
          },
          etaError: null,
        });
      }
      return computed;
    } catch (error) {
      const message = errorMessage(error);
      setCacheState(descriptor.cacheKey, {
        scope: descriptor.scope,
        scopeId: descriptor.scopeId,
        status: "error",
        progress: null,
        error: message,
      });
      if (options.publishActive && get().activeCacheKey === descriptor.cacheKey) {
        set({ etaStatus: "error", etaProgress: null, etaError: message });
      }
      return null;
    }
  };

  return {
    powerConfig: loadConfig(),
    cumulativeTime: null,
    routeId: null,
    cachedPoints: null,
    cachedFerries: [],
    activeCacheKey: null,
    etaStatus: "idle",
    etaProgress: null,
    etaError: null,
    cacheStates: {},

    updatePowerConfig: (partial) => {
      const next = { ...get().powerConfig, ...partial };
      try {
        getStorage().set("powerConfig", JSON.stringify(next));
      } catch {}
      set({
        powerConfig: next,
        cumulativeTime: null,
        routeId: null,
        cachedPoints: null,
        cachedFerries: [],
        activeCacheKey: null,
        etaStatus: "idle",
        etaProgress: null,
        etaError: null,
      });
    },

    computeETAForRoute: (routeId, points) => {
      // Skip if the exact same points array was already used for this route.
      // Reference equality handles variant swaps within a collection: same id,
      // different points array → fresh compute.
      if (get().routeId === routeId && get().cachedPoints === points && get().cumulativeTime) {
        return;
      }
      const cumulative = computeCachedRouteETA(routeId, points, get().powerConfig);
      set({
        cumulativeTime: cumulative,
        routeId,
        cachedPoints: points,
        cachedFerries: [],
        activeCacheKey: null,
        etaStatus: "ready",
        etaProgress: { computedPoints: points.length, totalPoints: points.length },
        etaError: null,
      });
    },

    ensureRelativeETA: (input) => ensure(input, { publishActive: true }),

    prewarmRelativeETA: (input) => {
      void ensure(input, { publishActive: false });
    },

    clearRelativeETACache: async (scopeId) => {
      await clearPersistentRelativeETACaches(scopeId);
      set((state) => {
        const cacheStates = scopeId
          ? Object.fromEntries(
              Object.entries(state.cacheStates).filter(([, value]) => value.scopeId !== scopeId),
            )
          : {};
        return {
          cacheStates,
          ...(scopeId == null || state.routeId === scopeId
            ? {
                cumulativeTime: null,
                routeId: null,
                cachedPoints: null,
                cachedFerries: [],
                activeCacheKey: null,
                etaStatus: "idle" as const,
                etaProgress: null,
                etaError: null,
              }
            : {}),
        };
      });
    },

    invalidateCache: () => {
      set({
        cumulativeTime: null,
        routeId: null,
        cachedPoints: null,
        cachedFerries: [],
        activeCacheKey: null,
        etaStatus: "idle",
        etaProgress: null,
        etaError: null,
      });
    },

    getETAToPOI: (poi) => {
      const stitched = useCollectionStore.getState().activeStitchedCollection;
      const segments =
        stitched && stitched.collectionId === get().routeId ? stitched.segments : null;
      const displayPOI = toDisplayPOIForSegments(poi, segments);
      if (!displayPOI) return null;

      return get().resolveETA(displayPOI.effectiveDistanceMeters);
    },

    getETAToDistance: (distAlongRouteM) => {
      return get().resolveETA(distAlongRouteM);
    },

    resolveETA: (targetDistM) => {
      const { cumulativeTime, routeId, cachedPoints, cachedFerries } = get();
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
        cachedFerries,
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
  };
});
