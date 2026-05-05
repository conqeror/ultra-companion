import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type {
  DisplayPOI,
  POI,
  POICategory,
  POIDiscoverySource,
  POIFetchStatus,
  POIFetchedSource,
  RoutePoint,
} from "@/types";
import {
  DEFAULT_CORRIDOR_WIDTH_M,
  DEFAULT_POI_DISCOVERY_CATEGORIES,
  POI_CATEGORIES,
  normalizePoiCategories as normalizeKnownPoiCategories,
  poiDiscoveryCategoriesForSource,
} from "@/constants";
import {
  getPOIsForRoute,
  deletePOIsBySource,
  insertPOIs,
  updatePOITags,
  deletePOI,
} from "@/db/database";
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

const allPoiCategories = (): POICategory[] => POI_CATEGORIES.map((c) => c.key);

export function parsePersistedEnabledCategories(raw: string | undefined): POICategory[] {
  if (raw === undefined) return allPoiCategories();
  try {
    return normalizeKnownPoiCategories(JSON.parse(raw) as POICategory[]);
  } catch {
    return allPoiCategories();
  }
}

function normalizeCategories(categories: POICategory[]): POICategory[] {
  const valid = new Set<string>(POI_CATEGORIES.map((c) => c.key));
  return Array.from(new Set(categories)).filter((c) => valid.has(c)) as POICategory[];
}

function parseDiscoveryCategories(raw: string | undefined): POICategory[] {
  if (raw === undefined) return DEFAULT_POI_DISCOVERY_CATEGORIES;
  try {
    const parsed = JSON.parse(raw) as POICategory[];
    return normalizeKnownPoiCategories(parsed);
  } catch {
    return DEFAULT_POI_DISCOVERY_CATEGORIES;
  }
}

export interface ProgressInfo {
  phase: string;
  done: number;
  total: number;
}

export interface SourceInfo {
  status: POIFetchStatus;
  count: number;
  fetchedAt: string | null; // ISO 8601
  error: string | null;
  progress: ProgressInfo | null; // in-memory only; never persisted
}

export const DEFAULT_SOURCE_INFO: SourceInfo = {
  status: "idle",
  count: 0,
  fetchedAt: null,
  error: null,
  progress: null,
};

const fetchGenerations = new Map<string, number>();

function fetchGenerationKey(routeId: string, source: POIFetchedSource): string {
  return `${routeId}:${source}`;
}

function nextFetchGeneration(routeId: string, source: POIFetchedSource): number {
  const key = fetchGenerationKey(routeId, source);
  const next = (fetchGenerations.get(key) ?? 0) + 1;
  fetchGenerations.set(key, next);
  return next;
}

function isCurrentFetch(routeId: string, source: POIFetchedSource, generation: number): boolean {
  return fetchGenerations.get(fetchGenerationKey(routeId, source)) === generation;
}

function invalidateRouteFetches(routeId: string): void {
  nextFetchGeneration(routeId, "osm");
  nextFetchGeneration(routeId, "google");
}

const SOURCE_INFO_KEY_PREFIX = "sourceInfo_";
const sourceInfoKey = (routeId: string, source: POIFetchedSource) =>
  `${SOURCE_INFO_KEY_PREFIX}${source}_${routeId}`;

function readSourceInfo(routeId: string, source: POIFetchedSource): SourceInfo {
  try {
    const raw = getStorage().getString(sourceInfoKey(routeId, source));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SourceInfo>;
      return { ...DEFAULT_SOURCE_INFO, ...parsed, progress: null };
    }
  } catch {}
  return { ...DEFAULT_SOURCE_INFO };
}

function persistSourceInfo(routeId: string, source: POIFetchedSource, info: SourceInfo): void {
  try {
    const { progress: _progress, ...persisted } = info;
    getStorage().set(sourceInfoKey(routeId, source), JSON.stringify(persisted));
  } catch {}
}

function clearSourceInfo(routeId: string, source: POIFetchedSource): void {
  try {
    getStorage().remove(sourceInfoKey(routeId, source));
  } catch {}
}

/**
 * One-shot cleanup at store init: any persisted "fetching" status is stale
 * (fetches don't survive app restarts), so coerce and write back. After this
 * runs, readers can trust the persisted status.
 */
function normalizePersistedStatuses(): void {
  const s = getStorage();
  try {
    for (const key of s.getAllKeys()) {
      if (!key.startsWith(SOURCE_INFO_KEY_PREFIX)) continue;
      const raw = s.getString(key);
      if (!raw) continue;
      try {
        const info = JSON.parse(raw) as Partial<SourceInfo>;
        if (info.status === "fetching") {
          const fixed = {
            ...info,
            status: (info.count ?? 0) > 0 ? "done" : "idle",
          };
          delete (fixed as Partial<SourceInfo>).progress;
          s.set(key, JSON.stringify(fixed));
        }
      } catch {
        s.remove(key); // drop corrupt entries
      }
    }
  } catch {}
}

normalizePersistedStatuses();

type ScrubMode = "reset" | "remove";

/**
 * Builds the state patch for clearing all per-route POI state. "reset" keeps
 * the sourceInfo[routeId] entry but resets both sources to defaults (used by
 * clearPOIs). "remove" drops the entry entirely (used when the route itself
 * is deleted).
 */
function buildRouteScrubPatch(
  s: {
    pois: Record<string, POI[]>;
    sourceInfo: Record<string, Record<POIFetchedSource, SourceInfo>>;
    starredPOIIds: Set<string>;
    selectedPOI: DisplayPOI | null;
  },
  routeId: string,
  mode: ScrubMode,
) {
  const { [routeId]: removed, ...remainingPois } = s.pois;
  const removedIds = new Set((removed ?? []).map((p) => p.id));
  const nextStarred = new Set([...s.starredPOIIds].filter((id) => !removedIds.has(id)));
  const starredChanged = nextStarred.size !== s.starredPOIIds.size;
  if (starredChanged) {
    try {
      getStorage().set("starredPOIIds", JSON.stringify([...nextStarred]));
    } catch {}
  }

  let sourceInfo: typeof s.sourceInfo;
  if (mode === "remove") {
    const { [routeId]: _dropped, ...rest } = s.sourceInfo;
    sourceInfo = rest;
  } else {
    sourceInfo = {
      ...s.sourceInfo,
      [routeId]: { osm: { ...DEFAULT_SOURCE_INFO }, google: { ...DEFAULT_SOURCE_INFO } },
    };
  }

  return {
    pois: remainingPois,
    sourceInfo,
    starredPOIIds: starredChanged ? nextStarred : s.starredPOIIds,
    selectedPOI: s.selectedPOI?.routeId === routeId ? null : s.selectedPOI,
  };
}

interface POIState {
  // POI data per route
  pois: Record<string, POI[]>;

  // Filter state (persisted)
  enabledCategories: POICategory[];
  discoveryCategories: POICategory[];
  corridorWidthM: number;
  showOpenOnly: boolean;
  starredPOIIds: Set<string>;

  // Fetch state per fetched source per route
  sourceInfo: Record<string, Record<POIFetchedSource, SourceInfo>>; // routeId -> source -> info

  // UI state
  selectedPOI: DisplayPOI | null;

  // Actions
  loadPOIs: (routeId: string) => Promise<void>;
  fetchSource: (
    routeId: string,
    source: POIFetchedSource,
    routePoints: RoutePoint[],
  ) => Promise<void>;
  clearSource: (routeId: string, source: POIFetchedSource) => Promise<void>;
  addCustomPOI: (poi: POI) => Promise<void>;
  updatePOINotes: (routeId: string, poiId: string, notes: string) => Promise<void>;
  deleteCustomPOI: (routeId: string, poiId: string) => Promise<void>;
  toggleCategory: (category: POICategory) => void;
  setEnabledCategories: (categories: POICategory[]) => void;
  setDiscoveryCategories: (categories: POICategory[]) => void;
  setDiscoveryGroupEnabled: (categories: POICategory[], enabled: boolean) => void;
  resetDiscoveryCategories: () => void;
  hasDiscoveryCategoriesForSource: (source: POIDiscoverySource) => boolean;
  setCorridorWidth: (widthM: number) => void;
  setAllCategories: (enabled: boolean) => void;
  toggleShowOpenOnly: () => void;
  toggleStarred: (poiId: string) => void;
  isStarred: (poiId: string) => boolean;
  getStarredPOIs: (routeId: string) => POI[];
  clearPOIs: (routeId: string) => Promise<void>;
  cleanupRouteState: (routeId: string) => void;
  setSelectedPOI: (poi: DisplayPOI | null) => void;

  // Computed helpers
  getVisiblePOIs: (routeId: string) => POI[];
  getNextPOIPerCategory: (
    routeId: string,
    currentDistAlongRoute: number,
  ) => Partial<Record<POICategory, POI>>;
}

export const usePoiStore = create<POIState>((set, get) => ({
  pois: {},
  enabledCategories: parsePersistedEnabledCategories(readString("enabledCategories")),
  discoveryCategories: parseDiscoveryCategories(readString("discoveryCategories")),
  corridorWidthM: Number(readString("corridorWidthM")) || DEFAULT_CORRIDOR_WIDTH_M,
  showOpenOnly: readString("showOpenOnly") === "true",
  starredPOIIds: parseStarredIds(readString("starredPOIIds")),
  sourceInfo: {},
  selectedPOI: null,

  loadPOIs: async (routeId) => {
    // Read from DB to derive counts. Merge with in-memory sourceInfo so we
    // never clobber an active "fetching" or surfaced "error" status — only
    // fall back to MMKV when there's no in-memory entry yet (cold start).
    const pois = await getPOIsForRoute(routeId);
    let osmCount = 0,
      googleCount = 0;
    for (const p of pois) {
      if (p.source === "google") googleCount++;
      else if (p.source === "osm") osmCount++;
    }

    set((s) => {
      const info = s.sourceInfo[routeId];
      if (info && info.osm.count === osmCount && info.google.count === googleCount) {
        return s;
      }

      const osm = info?.osm ?? readSourceInfo(routeId, "osm");
      const google = info?.google ?? readSourceInfo(routeId, "google");

      const nextOsm = { ...osm, count: osmCount };
      if (nextOsm.status === "idle" && osmCount > 0) nextOsm.status = "done";
      const nextGoogle = { ...google, count: googleCount };
      if (nextGoogle.status === "idle" && googleCount > 0) nextGoogle.status = "done";

      return {
        pois: { ...s.pois, [routeId]: pois },
        sourceInfo: {
          ...s.sourceInfo,
          [routeId]: { osm: nextOsm, google: nextGoogle },
        },
      };
    });
  },

  fetchSource: async (routeId, source, routePoints) => {
    const generation = nextFetchGeneration(routeId, source);
    const updateSourceInfo = (partial: Partial<SourceInfo>, opts?: { persist?: boolean }) => {
      if (!isCurrentFetch(routeId, source, generation)) return;
      set((s) => {
        const current = s.sourceInfo[routeId]?.[source] ?? { ...DEFAULT_SOURCE_INFO };
        const updated = { ...current, ...partial };
        if (opts?.persist !== false) persistSourceInfo(routeId, source, updated);
        return {
          sourceInfo: {
            ...s.sourceInfo,
            [routeId]: { ...s.sourceInfo[routeId], [source]: updated },
          },
        };
      });
    };

    updateSourceInfo({ status: "fetching", error: null, progress: null });

    try {
      const corridorWidthM = get().corridorWidthM;
      const discoveryCategories = get().discoveryCategories;
      const fetchFn = source === "osm" ? fetchOsmPOIs : fetchGooglePOIs;
      const count = await fetchFn(
        routeId,
        routePoints,
        corridorWidthM,
        (phase, done, total) => {
          // progress is ephemeral — skip MMKV write, it'd churn on every tick
          updateSourceInfo({ progress: { phase, done, total } }, { persist: false });
        },
        discoveryCategories,
      );
      updateSourceInfo({
        status: "done",
        count,
        fetchedAt: new Date().toISOString(),
        error: null,
        progress: null,
      });

      if (!isCurrentFetch(routeId, source, generation)) return;
      const pois = await getPOIsForRoute(routeId);
      if (!isCurrentFetch(routeId, source, generation)) return;
      set((s) => ({ pois: { ...s.pois, [routeId]: pois } }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to fetch POIs";
      updateSourceInfo({ status: "error", error: message, progress: null });
    }
  },

  clearSource: async (routeId, source) => {
    nextFetchGeneration(routeId, source);
    await deletePOIsBySource(routeId, source);
    clearSourceInfo(routeId, source);

    // Reload remaining POIs
    const pois = await getPOIsForRoute(routeId);
    set((s) => {
      const droppedSelection =
        s.selectedPOI?.routeId === routeId && s.selectedPOI?.source === source;
      return {
        pois: { ...s.pois, [routeId]: pois },
        selectedPOI: droppedSelection ? null : s.selectedPOI,
        sourceInfo: {
          ...s.sourceInfo,
          [routeId]: {
            ...s.sourceInfo[routeId],
            [source]: { ...DEFAULT_SOURCE_INFO },
          },
        },
      };
    });
  },

  addCustomPOI: async (poi) => {
    await insertPOIs([poi]);
    const pois = await getPOIsForRoute(poi.routeId);
    set((s) => {
      const nextStarred = new Set([...s.starredPOIIds, poi.id]);
      try {
        getStorage().set("starredPOIIds", JSON.stringify([...nextStarred]));
      } catch {}
      return {
        pois: { ...s.pois, [poi.routeId]: pois },
        starredPOIIds: nextStarred,
      };
    });
  },

  updatePOINotes: async (routeId, poiId, notes) => {
    const routePois = get().pois[routeId] ?? (await getPOIsForRoute(routeId));
    const poi = routePois.find((p) => p.id === poiId);
    if (!poi) return;

    const nextTags = { ...poi.tags };
    const trimmed = notes.trim();
    if (trimmed) nextTags.notes = trimmed;
    else delete nextTags.notes;

    await updatePOITags(poiId, nextTags);
    const pois = await getPOIsForRoute(routeId);

    set((s) => {
      const selectedPOI =
        s.selectedPOI?.id === poiId ? { ...s.selectedPOI, tags: nextTags } : s.selectedPOI;
      return {
        pois: { ...s.pois, [routeId]: pois },
        selectedPOI,
      };
    });
  },

  deleteCustomPOI: async (routeId, poiId) => {
    await deletePOI(poiId);
    const pois = await getPOIsForRoute(routeId);
    set((s) => {
      const nextStarred = new Set(s.starredPOIIds);
      nextStarred.delete(poiId);
      try {
        getStorage().set("starredPOIIds", JSON.stringify([...nextStarred]));
      } catch {}
      return {
        pois: { ...s.pois, [routeId]: pois },
        starredPOIIds: nextStarred,
        selectedPOI: s.selectedPOI?.id === poiId ? null : s.selectedPOI,
      };
    });
  },

  toggleCategory: (category) => {
    const current = get().enabledCategories;
    const next = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    try {
      getStorage().set("enabledCategories", JSON.stringify(next));
    } catch {}
    set({ enabledCategories: next });
  },

  setEnabledCategories: (categories) => {
    const next = normalizeCategories(categories);
    try {
      getStorage().set("enabledCategories", JSON.stringify(next));
    } catch {}
    set({ enabledCategories: next });
  },

  setDiscoveryCategories: (categories) => {
    const next = normalizeKnownPoiCategories(categories);
    try {
      getStorage().set("discoveryCategories", JSON.stringify(next));
    } catch {}
    set({ discoveryCategories: next });
  },

  setDiscoveryGroupEnabled: (categories, enabled) => {
    const current = new Set(get().discoveryCategories);
    for (const category of categories) {
      if (enabled) current.add(category);
      else current.delete(category);
    }
    get().setDiscoveryCategories([...current]);
  },

  resetDiscoveryCategories: () => {
    get().setDiscoveryCategories(DEFAULT_POI_DISCOVERY_CATEGORIES);
  },

  hasDiscoveryCategoriesForSource: (source) =>
    poiDiscoveryCategoriesForSource(get().discoveryCategories, source).length > 0,

  setCorridorWidth: (widthM) => {
    try {
      getStorage().set("corridorWidthM", String(widthM));
    } catch {}
    set({ corridorWidthM: widthM });
  },

  setAllCategories: (enabled) => {
    const next = enabled ? POI_CATEGORIES.map((c) => c.key) : [];
    try {
      getStorage().set("enabledCategories", JSON.stringify(next));
    } catch {}
    set({ enabledCategories: next });
  },

  toggleShowOpenOnly: () => {
    const next = !get().showOpenOnly;
    try {
      getStorage().set("showOpenOnly", String(next));
    } catch {}
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
    try {
      getStorage().set("starredPOIIds", JSON.stringify([...next]));
    } catch {}
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
    invalidateRouteFetches(routeId);
    await deletePOIsBySource(routeId, "google");
    await deletePOIsBySource(routeId, "osm");
    clearSourceInfo(routeId, "osm");
    clearSourceInfo(routeId, "google");
    const pois = await getPOIsForRoute(routeId);
    set((s) => {
      const currentRoutePois = s.pois[routeId] ?? [];
      const removedIds = new Set(
        currentRoutePois.filter((p) => p.source !== "custom").map((p) => p.id),
      );
      const nextStarred = new Set([...s.starredPOIIds].filter((id) => !removedIds.has(id)));
      try {
        getStorage().set("starredPOIIds", JSON.stringify([...nextStarred]));
      } catch {}
      const selectedPOI =
        s.selectedPOI?.routeId === routeId && s.selectedPOI.source !== "custom"
          ? null
          : s.selectedPOI;
      return {
        pois: { ...s.pois, [routeId]: pois },
        sourceInfo: {
          ...s.sourceInfo,
          [routeId]: { osm: { ...DEFAULT_SOURCE_INFO }, google: { ...DEFAULT_SOURCE_INFO } },
        },
        starredPOIIds: nextStarred,
        selectedPOI,
      };
    });
  },

  cleanupRouteState: (routeId) => {
    // Called when a route is deleted. DB cascade handles pois rows; this
    // only scrubs in-memory state + MMKV source metadata so nothing orphans.
    invalidateRouteFetches(routeId);
    clearSourceInfo(routeId, "osm");
    clearSourceInfo(routeId, "google");
    set((s) => buildRouteScrubPatch(s, routeId, "remove"));
  },

  setSelectedPOI: (poi) => {
    set({ selectedPOI: poi });
    if (poi) usePanelStore.getState().setPanelTab("pois");
  },
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
