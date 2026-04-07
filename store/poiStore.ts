import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { POI, POICategory, POIFetchStatus, POISource, RoutePoint } from "@/types";
import { DEFAULT_CORRIDOR_WIDTH_M, POI_CATEGORIES } from "@/constants";
import { getPOIsForRoute, deletePOIsBySource, deletePOIsForRoute } from "@/db/database";
import { fetchOsmPOIs, fetchGooglePOIs } from "@/services/poiFetcher";
import { getOpeningHoursStatus } from "@/services/openingHoursParser";
import { usePanelStore } from "./panelStore";

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

function parseStarredIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function parseCategories(raw: string | undefined): POICategory[] {
  if (!raw) return [];
  try {
    const valid = new Set<string>(POI_CATEGORIES.map((c) => c.key));
    return (JSON.parse(raw) as string[]).filter((c) => valid.has(c)) as POICategory[];
  } catch {
    return [];
  }
}

export interface SourceInfo {
  status: POIFetchStatus;
  count: number;
  fetchedAt: string | null; // ISO 8601
  error: string | null;
}

export const DEFAULT_SOURCE_INFO: SourceInfo = { status: "idle", count: 0, fetchedAt: null, error: null };

function readSourceInfo(routeId: string, source: POISource): SourceInfo {
  try {
    const raw = getStorage().getString(`sourceInfo_${source}_${routeId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { ...DEFAULT_SOURCE_INFO };
}

function persistSourceInfo(routeId: string, source: POISource, info: SourceInfo): void {
  try {
    getStorage().set(`sourceInfo_${source}_${routeId}`, JSON.stringify(info));
  } catch {}
}

function clearSourceInfo(routeId: string, source: POISource): void {
  try {
    getStorage().remove(`sourceInfo_${source}_${routeId}`);
  } catch {}
}

interface POIState {
  // POI data per route
  pois: Record<string, POI[]>;

  // Filter state (persisted)
  enabledCategories: POICategory[];
  corridorWidthM: number;
  showOpenOnly: boolean;
  starredPOIIds: Set<string>;

  // Fetch state per source per route
  sourceInfo: Record<string, Record<POISource, SourceInfo>>; // routeId -> source -> info
  fetchProgress: { phase: string; done: number; total: number } | null;

  // UI state
  selectedPOI: POI | null;
  showPOIList: boolean;

  // Actions
  loadPOIs: (routeId: string) => Promise<void>;
  fetchSource: (routeId: string, source: POISource, routePoints: RoutePoint[]) => Promise<void>;
  clearSource: (routeId: string, source: POISource) => Promise<void>;
  toggleCategory: (category: POICategory) => void;
  setCorridorWidth: (widthM: number) => void;
  setAllCategories: (enabled: boolean) => void;
  toggleShowOpenOnly: () => void;
  toggleStarred: (poiId: string) => void;
  isStarred: (poiId: string) => boolean;
  getStarredPOIs: (routeId: string) => POI[];
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
  showOpenOnly: readString("showOpenOnly") === "true",
  starredPOIIds: parseStarredIds(readString("starredPOIIds")),
  sourceInfo: {},
  fetchProgress: null,
  selectedPOI: null,
  showPOIList: false,

  loadPOIs: async (routeId) => {
    const existing = get().pois[routeId];
    if (existing) return;
    const pois = await getPOIsForRoute(routeId);
    if (pois.length > 0) {
      const osmInfo = readSourceInfo(routeId, "osm");
      const googleInfo = readSourceInfo(routeId, "google");
      // Derive counts from fetched data instead of a separate DB query
      let osmCount = 0, googleCount = 0;
      for (const p of pois) {
        if (p.source === "google") googleCount++;
        else osmCount++;
      }
      osmInfo.count = osmCount;
      googleInfo.count = googleCount;
      if (osmCount > 0 && osmInfo.status === "idle") osmInfo.status = "done";
      if (googleCount > 0 && googleInfo.status === "idle") googleInfo.status = "done";

      set((s) => ({
        pois: { ...s.pois, [routeId]: pois },
        sourceInfo: {
          ...s.sourceInfo,
          [routeId]: { osm: osmInfo, google: googleInfo },
        },
      }));
    }
  },

  fetchSource: async (routeId, source, routePoints) => {
    const updateSourceInfo = (partial: Partial<SourceInfo>) => {
      set((s) => {
        const current = s.sourceInfo[routeId]?.[source] ?? { ...DEFAULT_SOURCE_INFO };
        const updated = { ...current, ...partial };
        persistSourceInfo(routeId, source, updated);
        return {
          sourceInfo: {
            ...s.sourceInfo,
            [routeId]: { ...s.sourceInfo[routeId], [source]: updated },
          },
        };
      });
    };

    updateSourceInfo({ status: "fetching", error: null });
    set({ fetchProgress: null });

    try {
      const corridorWidthM = get().corridorWidthM;
      const fetchFn = source === "osm" ? fetchOsmPOIs : fetchGooglePOIs;
      const count = await fetchFn(routeId, routePoints, corridorWidthM, (phase, done, total) => {
        set({ fetchProgress: { phase, done, total } });
      });
      updateSourceInfo({ status: "done", count, fetchedAt: new Date().toISOString(), error: null });

      // Reload all POIs from DB
      const pois = await getPOIsForRoute(routeId);
      set((s) => ({
        pois: { ...s.pois, [routeId]: pois },
        fetchProgress: null,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch POIs";
      updateSourceInfo({ status: "error", error: message });
      set({ fetchProgress: null });
    }
  },

  clearSource: async (routeId, source) => {
    await deletePOIsBySource(routeId, source);
    clearSourceInfo(routeId, source);

    // Reload remaining POIs
    const pois = await getPOIsForRoute(routeId);
    set((s) => ({
      pois: { ...s.pois, [routeId]: pois },
      sourceInfo: {
        ...s.sourceInfo,
        [routeId]: {
          ...s.sourceInfo[routeId],
          [source]: { ...DEFAULT_SOURCE_INFO },
        },
      },
    }));
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

  toggleShowOpenOnly: () => {
    const next = !get().showOpenOnly;
    try { getStorage().set("showOpenOnly", String(next)); } catch {}
    set({ showOpenOnly: next });
  },

  toggleStarred: (poiId) => {
    const current = get().starredPOIIds;
    const next = new Set(current);
    if (next.has(poiId)) {
      next.delete(poiId);
    } else {
      next.add(poiId);
    }
    try { getStorage().set("starredPOIIds", JSON.stringify([...next])); } catch {}
    set({ starredPOIIds: next });
  },

  isStarred: (poiId) => get().starredPOIIds.has(poiId),

  getStarredPOIs: (routeId) => {
    const state = get();
    const all = state.pois[routeId];
    if (!all) return [];
    return all.filter((p) => state.starredPOIIds.has(p.id));
  },

  clearPOIs: async (routeId) => {
    await deletePOIsForRoute(routeId);
    clearSourceInfo(routeId, "osm");
    clearSourceInfo(routeId, "google");
    set((s) => {
      const { [routeId]: _, ...rest } = s.pois;
      return {
        pois: rest,
        sourceInfo: {
          ...s.sourceInfo,
          [routeId]: { osm: { ...DEFAULT_SOURCE_INFO }, google: { ...DEFAULT_SOURCE_INFO } },
        },
      };
    });
  },

  setSelectedPOI: (poi) => {
    set({ selectedPOI: poi });
    if (poi) usePanelStore.getState().setPanelTab("pois");
  },
  setShowPOIList: (show) => set({ showPOIList: show }),

  getVisiblePOIs: (routeId) => {
    const state = get();
    const all = state.pois[routeId];
    if (!all) return [];
    const enabled = new Set(state.enabledCategories);
    return all.filter((p) => {
      // Always show starred POIs
      if (state.starredPOIIds.has(p.id)) return true;
      if (!enabled.has(p.category)) return false;
      if (state.showOpenOnly && p.tags?.opening_hours) {
        const status = getOpeningHoursStatus(p.tags.opening_hours);
        if (status && !status.isOpen) return false;
      }
      return true;
    });
  },

  getNextPOIPerCategory: (routeId, currentDistAlongRoute) => {
    const state = get();
    const all = state.pois[routeId];
    if (!all) return {};

    const enabled = new Set(state.enabledCategories);
    const result: Partial<Record<POICategory, POI>> = {};

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
