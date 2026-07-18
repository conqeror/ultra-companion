import { create } from "zustand";
import {
  deleteFerryCrossing as dbDeleteFerryCrossing,
  getFerryCrossingsForRoute,
  upsertFerryCrossing as dbUpsertFerryCrossing,
} from "@/db/database";
import { mapFerryCrossingsToSourceSpans } from "@/services/ferryCrossings";
import type { DisplayFerryCrossing, FerryCrossing, RoutePoint, StitchedSegmentInfo } from "@/types";

interface FerryState {
  ferries: Record<string, FerryCrossing[]>;
  loadingRouteIds: Set<string>;
  /** Changes whenever persisted ferry data changes, including routes not currently loaded. */
  revision: number;
  loadFerries: (routeId: string, options?: { force?: boolean }) => Promise<void>;
  saveFerry: (crossing: FerryCrossing) => Promise<void>;
  deleteFerry: (routeId: string, crossingId: string) => Promise<void>;
  cleanupRouteState: (routeId: string) => void;
  clearFerryCache: () => void;
  getFerriesForDisplay: (
    routeIds: string[],
    segments: StitchedSegmentInfo[] | null,
    pointsByRouteId?: Record<string, RoutePoint[]>,
  ) => DisplayFerryCrossing[];
}

async function invalidateActiveETA(): Promise<void> {
  const { useEtaStore } = await import("./etaStore");
  useEtaStore.getState().invalidateCache();
}

export const useFerryStore = create<FerryState>((set, get) => ({
  ferries: {},
  loadingRouteIds: new Set(),
  revision: 0,

  loadFerries: async (routeId, options) => {
    if (!options?.force && get().ferries[routeId]) return;
    if (get().loadingRouteIds.has(routeId)) return;
    set((state) => ({ loadingRouteIds: new Set(state.loadingRouteIds).add(routeId) }));
    try {
      const crossings = await getFerryCrossingsForRoute(routeId);
      set((state) => ({ ferries: { ...state.ferries, [routeId]: crossings } }));
    } finally {
      set((state) => {
        const loadingRouteIds = new Set(state.loadingRouteIds);
        loadingRouteIds.delete(routeId);
        return { loadingRouteIds };
      });
    }
  },

  saveFerry: async (crossing) => {
    await dbUpsertFerryCrossing(crossing);
    set((state) => {
      const existing = state.ferries[crossing.routeId] ?? [];
      const next = [...existing.filter((item) => item.id !== crossing.id), crossing].sort(
        (a, b) => a.startDistanceMeters - b.startDistanceMeters,
      );
      return {
        ferries: { ...state.ferries, [crossing.routeId]: next },
        revision: state.revision + 1,
      };
    });
    await invalidateActiveETA();
  },

  deleteFerry: async (routeId, crossingId) => {
    await dbDeleteFerryCrossing(crossingId);
    set((state) => ({
      ferries: {
        ...state.ferries,
        [routeId]: (state.ferries[routeId] ?? []).filter((item) => item.id !== crossingId),
      },
      revision: state.revision + 1,
    }));
    await invalidateActiveETA();
  },

  cleanupRouteState: (routeId) =>
    set((state) => {
      const { [routeId]: _removed, ...ferries } = state.ferries;
      const loadingRouteIds = new Set(state.loadingRouteIds);
      loadingRouteIds.delete(routeId);
      return { ferries, loadingRouteIds, revision: state.revision + 1 };
    }),

  clearFerryCache: () =>
    set((state) => ({
      ferries: {},
      loadingRouteIds: new Set(),
      revision: state.revision + 1,
    })),

  getFerriesForDisplay: (routeIds, segments, pointsByRouteId = {}) => {
    const crossings = routeIds.flatMap((routeId) => get().ferries[routeId] ?? []);
    return mapFerryCrossingsToSourceSpans(
      crossings,
      segments?.flatMap((segment) => segment.sourceSpans) ?? null,
      pointsByRouteId,
    );
  },
}));
