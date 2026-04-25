import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import {
  getAllRoutes,
  insertRoute,
  deleteRoute as dbDeleteRoute,
  updateRouteVisibility,
  setActiveRoute as dbSetActiveRoute,
  getRouteWithPoints,
  getRoutePoints,
} from "@/db/database";
import { parseGPX } from "@/services/gpxParser";
import { parseKML } from "@/services/kmlParser";
import { INACTIVE_ROUTE_COLOR } from "@/constants";
import { generateId } from "@/utils/generateId";
import type { Route, RouteWithPoints, RoutePoint, SnappedPosition } from "@/types";

interface RouteState {
  routes: Route[];
  isLoading: boolean;
  error: string | null;
  // Lazily cached point arrays for routes that currently need full geometry.
  visibleRoutePoints: Record<string, RoutePoint[]>;
  // Snapped position on active route
  snappedPosition: SnappedPosition | null;

  /** Fetch route metadata only. Cheap; safe to call on every tab mount. */
  loadRouteMetadata: () => Promise<void>;
  /** Ensure point arrays are loaded for the given routes without touching unrelated metadata. */
  loadRoutePoints: (routeIds: string[], options?: { prune?: boolean }) => Promise<void>;
  /**
   * Ensure `visibleRoutePoints` contains points for every currently-visible
   * route. Reuses already-cached entries and fetches missing ones in parallel.
   * Drops entries for routes that are no longer visible.
   */
  loadVisibleRoutePoints: () => Promise<void>;
  /** Load metadata, then visible points. Use when both are needed. */
  loadRoutesAndPoints: () => Promise<void>;
  importRoute: () => Promise<void>;
  importFromUri: (uri: string, fileName: string) => Promise<Route>;
  deleteRoute: (id: string) => Promise<void>;
  toggleVisibility: (id: string) => Promise<void>;
  setActiveRoute: (id: string) => Promise<void>;
  getRouteDetail: (id: string) => Promise<RouteWithPoints | null>;
  setSnappedPosition: (pos: SnappedPosition | null) => void;
  clearError: () => void;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  routes: [],
  isLoading: false,
  error: null,
  visibleRoutePoints: {},
  snappedPosition: null,

  loadRouteMetadata: async () => {
    try {
      const routes = await getAllRoutes();
      set({ routes });
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  loadRoutesAndPoints: async () => {
    await get().loadRouteMetadata();
    await get().loadVisibleRoutePoints();
  },

  loadRoutePoints: async (routeIds, options) => {
    const ids = [...new Set(routeIds.filter(Boolean))];
    const current = get().visibleRoutePoints;

    if (ids.length === 0) {
      if (options?.prune && Object.keys(current).length > 0) {
        set({ visibleRoutePoints: {} });
      }
      return;
    }

    const keepIds = new Set(ids);
    const toLoad = ids.filter((id) => !current[id]);
    if (toLoad.length === 0 && !options?.prune) return;

    const loaded = await Promise.all(
      toLoad.map(async (id) => [id, await getRoutePoints(id)] as const),
    );

    const next: Record<string, RoutePoint[]> = {};
    if (options?.prune) {
      for (const id of ids) {
        if (current[id]) next[id] = current[id];
      }
    } else {
      Object.assign(next, current);
    }
    for (const [id, pts] of loaded) {
      if (!options?.prune || keepIds.has(id)) next[id] = pts;
    }
    set({ visibleRoutePoints: next });
  },

  importFromUri: async (uri: string, fileName: string) => {
    const ext = fileName.toLowerCase().split(".").pop();

    if (!["gpx", "kml"].includes(ext || "")) {
      throw new Error("Unsupported file type. Use .gpx or .kml files.");
    }

    let content: string;
    try {
      content = await new File(uri).text();
    } catch {
      // Fallback: AppDelegate copies share-sheet files to Caches/pending-import.<ext>
      // while iOS security scope is still active (see AppDelegate.swift copyImportedFileToTmpIfNeeded)
      const fallback = new File(Paths.cache, `pending-import.${ext}`);
      content = await fallback.text();
      try {
        fallback.delete();
      } catch {}
    }

    const parsed = ext === "gpx" ? parseGPX(content, fileName) : parseKML(content, fileName);

    const route: Route = {
      id: generateId(),
      name: parsed.name,
      fileName,
      color: INACTIVE_ROUTE_COLOR,
      isActive: false,
      isVisible: true,
      totalDistanceMeters: parsed.totalDistanceMeters,
      totalAscentMeters: parsed.totalAscentMeters,
      totalDescentMeters: parsed.totalDescentMeters,
      pointCount: parsed.points.length,
      createdAt: new Date().toISOString(),
    };

    await insertRoute(route, parsed.points);

    // Detect and store climbs
    const { detectAndStoreClimbs } = await import("@/services/climbDetector");
    await detectAndStoreClimbs(route.id, parsed.points);

    await get().loadRouteMetadata();
    return route;
  },

  importRoute: async () => {
    try {
      set({ isLoading: true, error: null });

      const result = await DocumentPicker.getDocumentAsync({
        type: ["application/gpx+xml", "application/vnd.google-earth.kml+xml", "*/*"],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.[0]) {
        set({ isLoading: false });
        return;
      }

      const asset = result.assets[0];
      const fileName = asset.name || "route";

      await get().importFromUri(asset.uri, fileName);
      set({ isLoading: false });
    } catch (e: any) {
      set({ isLoading: false, error: e.message || "Failed to import route" });
    }
  },

  deleteRoute: async (id) => {
    try {
      // Clean up offline tile data
      const { useOfflineStore } = await import("@/store/offlineStore");
      await useOfflineStore.getState().deleteOfflineData(id);
      await dbDeleteRoute(id);
      // Scrub per-route POI state (DB cascade handles the rows themselves)
      const { usePoiStore } = await import("@/store/poiStore");
      usePoiStore.getState().cleanupRouteState(id);
      // Drop points cache entry for the deleted route
      const current = get().visibleRoutePoints;
      if (current[id]) {
        const next = { ...current };
        delete next[id];
        set({ visibleRoutePoints: next });
      }
      await get().loadRouteMetadata();
      // Reload collections in case this route was in one (cascade deletes the segment)
      const { useCollectionStore } = await import("@/store/collectionStore");
      await useCollectionStore.getState().loadCollections();
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  toggleVisibility: async (id) => {
    const route = get().routes.find((r) => r.id === id);
    if (!route) return;
    const nextVisible = !route.isVisible;
    await updateRouteVisibility(id, nextVisible);
    if (!nextVisible && get().visibleRoutePoints[id]) {
      const next = { ...get().visibleRoutePoints };
      delete next[id];
      set({ visibleRoutePoints: next });
    }
    await get().loadRouteMetadata();
    if (nextVisible && route.isActive) {
      await get().loadRoutePoints([id], { prune: true });
    }
  },

  setActiveRoute: async (id) => {
    await dbSetActiveRoute(id);
    // Clear active collection in collectionStore
    const { useCollectionStore } = await import("@/store/collectionStore");
    useCollectionStore.getState().clearActiveStitched();
    await useCollectionStore.getState().loadCollections();
    // Load only the active route's points for the riding view.
    await get().loadRouteMetadata();
    await get().loadRoutePoints([id], { prune: true });
  },

  getRouteDetail: async (id) => {
    return getRouteWithPoints(id);
  },

  loadVisibleRoutePoints: async () => {
    const routes = get().routes.filter((r) => r.isVisible);
    await get().loadRoutePoints(
      routes.map((r) => r.id),
      { prune: true },
    );
  },

  setSnappedPosition: (snappedPosition) => {
    const prev = get().snappedPosition;
    if (
      prev?.pointIndex === snappedPosition?.pointIndex &&
      prev?.routeId === snappedPosition?.routeId
    )
      return;
    set({ snappedPosition });
  },

  clearError: () => set({ error: null }),
}));
