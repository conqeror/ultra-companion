import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { POI, POICategory, POIFetchStatus, RoutePoint } from "@/types";
import { DEFAULT_CORRIDOR_WIDTH_M, POI_CATEGORIES } from "@/constants";
import { getPOIsForRoute } from "@/db/database";
import { fetchAndStorePOIs } from "@/services/poiFetcher";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "poi" });
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

function parseCategories(raw: string | undefined): POICategory[] {
  if (!raw) return POI_CATEGORIES.map((c) => c.key);
  try {
    return JSON.parse(raw) as POICategory[];
  } catch {
    return POI_CATEGORIES.map((c) => c.key);
  }
}

interface POIState {
  // POI data per route
  pois: Record<string, POI[]>;

  // Filter state (persisted)
  enabledCategories: POICategory[];
  corridorWidthM: number;

  // Fetch state
  fetchStatus: Record<string, POIFetchStatus>;
  fetchProgress: { phase: string; done: number; total: number } | null;
  fetchError: string | null;

  // UI state
  selectedPOI: POI | null;
  showPOIList: boolean;

  // Actions
  loadPOIs: (routeId: string) => Promise<void>;
  fetchPOIs: (routeId: string, routePoints: RoutePoint[]) => Promise<void>;
  toggleCategory: (category: POICategory) => void;
  setCorridorWidth: (widthM: number) => void;
  setAllCategories: (enabled: boolean) => void;
  clearPOIs: (routeId: string) => Promise<void>;
  setSelectedPOI: (poi: POI | null) => void;
  setShowPOIList: (show: boolean) => void;

  // Computed helpers
  getVisiblePOIs: (routeId: string) => POI[];
  getNextPOIPerCategory: (
    routeId: string,
    currentDistAlongRoute: number,
  ) => Partial<Record<POICategory, POI>>;
}

export const usePoiStore = create<POIState>((set, get) => ({
  pois: {},
  enabledCategories: parseCategories(readString("enabledCategories")),
  corridorWidthM: Number(readString("corridorWidthM")) || DEFAULT_CORRIDOR_WIDTH_M,
  fetchStatus: {},
  fetchProgress: null,
  fetchError: null,
  selectedPOI: null,
  showPOIList: false,

  loadPOIs: async (routeId) => {
    const existing = get().pois[routeId];
    if (existing) return; // already loaded
    const pois = await getPOIsForRoute(routeId);
    if (pois.length > 0) {
      set((s) => ({
        pois: { ...s.pois, [routeId]: pois },
        fetchStatus: { ...s.fetchStatus, [routeId]: "done" },
      }));
    }
  },

  fetchPOIs: async (routeId, routePoints) => {
    set((s) => ({
      fetchStatus: { ...s.fetchStatus, [routeId]: "fetching" },
      fetchProgress: null,
      fetchError: null,
    }));

    try {
      const corridorWidthM = get().corridorWidthM;
      await fetchAndStorePOIs(routeId, routePoints, corridorWidthM, (phase, done, total) => {
        set({ fetchProgress: { phase, done, total } });
      });

      // Reload from DB
      const pois = await getPOIsForRoute(routeId);
      set((s) => ({
        pois: { ...s.pois, [routeId]: pois },
        fetchStatus: { ...s.fetchStatus, [routeId]: "done" },
        fetchProgress: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch POIs";
      set((s) => ({
        fetchStatus: { ...s.fetchStatus, [routeId]: "error" },
        fetchError: message,
        fetchProgress: null,
      }));
    }
  },

  toggleCategory: (category) => {
    const current = get().enabledCategories;
    const next = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    try { getStorage().set("enabledCategories", JSON.stringify(next)); } catch {}
    set({ enabledCategories: next });
  },

  setCorridorWidth: (widthM) => {
    try { getStorage().set("corridorWidthM", String(widthM)); } catch {}
    set({ corridorWidthM: widthM });
  },

  setAllCategories: (enabled) => {
    const next = enabled ? POI_CATEGORIES.map((c) => c.key) : [];
    try { getStorage().set("enabledCategories", JSON.stringify(next)); } catch {}
    set({ enabledCategories: next });
  },

  clearPOIs: async (routeId) => {
    const { deletePOIsForRoute } = await import("@/db/database");
    await deletePOIsForRoute(routeId);
    set((s) => {
      const { [routeId]: _, ...rest } = s.pois;
      return {
        pois: rest,
        fetchStatus: { ...s.fetchStatus, [routeId]: "idle" },
      };
    });
  },

  setSelectedPOI: (poi) => set({ selectedPOI: poi }),
  setShowPOIList: (show) => set({ showPOIList: show }),

  getVisiblePOIs: (routeId) => {
    const state = get();
    const all = state.pois[routeId];
    if (!all) return [];
    const enabled = new Set(state.enabledCategories);
    return all.filter((p) => enabled.has(p.category));
  },

  getNextPOIPerCategory: (routeId, currentDistAlongRoute) => {
    const state = get();
    const all = state.pois[routeId];
    if (!all) return {};

    const enabled = new Set(state.enabledCategories);
    const result: Partial<Record<POICategory, POI>> = {};

    // POIs are sorted by distanceAlongRouteMeters (from DB query)
    for (const poi of all) {
      if (!enabled.has(poi.category)) continue;
      if (poi.distanceAlongRouteMeters <= currentDistAlongRoute) continue;
      if (!result[poi.category]) {
        result[poi.category] = poi;
      }
    }

    return result;
  },
}));
