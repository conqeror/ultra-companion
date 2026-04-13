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
import type { Route, RouteWithPoints, RoutePoint, SnappedPosition, Climb } from "@/types";

interface RouteState {
  routes: Route[];
  isLoading: boolean;
  error: string | null;
  // Cached points for visible routes (for map rendering)
  visibleRoutePoints: Record<string, RoutePoint[]>;
  // Snapped position on active route
  snappedPosition: SnappedPosition | null;

  loadRoutes: () => Promise<void>;
  importRoute: () => Promise<void>;
  importFromUri: (uri: string, fileName: string) => Promise<Route>;
  deleteRoute: (id: string) => Promise<void>;
  toggleVisibility: (id: string) => Promise<void>;
  setActiveRoute: (id: string) => Promise<void>;
  getRouteDetail: (id: string) => Promise<RouteWithPoints | null>;
  loadVisibleRoutePoints: () => Promise<void>;
  setSnappedPosition: (pos: SnappedPosition | null) => void;
  clearError: () => void;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  routes: [],
  isLoading: false,
  error: null,
  visibleRoutePoints: {},
  snappedPosition: null,

  loadRoutes: async () => {
    try {
      const routes = await getAllRoutes();
      set({ routes });
      await get().loadVisibleRoutePoints();
    } catch (e: any) {
      set({ error: e.message });
    }
  },

  importFromUri: async (uri: string, fileName: string) => {
    const ext = fileName.toLowerCase().split(".").pop();

    if (!["gpx", "kml"].includes(ext || "")) {
      throw new Error("Unsupported file type. Use .gpx or .kml files.");
    }

    // Copy to cache first — iOS security-scoped URLs from the share sheet
    // aren't directly readable by JS (same reason DocumentPicker uses copyToCacheDirectory)
    const sourceFile = new File(uri);
    const cacheFile = new File(Paths.cache, `import_${Date.now()}.${ext}`);
    sourceFile.copy(cacheFile);
    let content: string;
    try {
      content = await cacheFile.text();
    } finally {
      try { cacheFile.delete(); } catch {}
    }

    const parsed = ext === "gpx"
      ? parseGPX(content, fileName)
      : parseKML(content, fileName);

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
    const { detectClimbs } = await import("@/services/climbDetector");
    const { insertClimbs } = await import("@/db/database");
    const detected = detectClimbs(parsed.points);
    const climbRecords: Climb[] = detected.map((c) => ({
      ...c,
      id: generateId(),
      routeId: route.id,
      name: null,
    }));
    await insertClimbs(climbRecords);

    await get().loadRoutes();
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
      await get().loadRoutes();
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
    await updateRouteVisibility(id, !route.isVisible);
    await get().loadRoutes();
  },

  setActiveRoute: async (id) => {
    await dbSetActiveRoute(id);
    // Clear active collection in collectionStore
    const { useCollectionStore } = await import("@/store/collectionStore");
    useCollectionStore.getState().clearActiveStitched();
    await useCollectionStore.getState().loadCollections();
    await get().loadRoutes();
  },

  getRouteDetail: async (id) => {
    return getRouteWithPoints(id);
  },

  loadVisibleRoutePoints: async () => {
    const routes = get().routes.filter((r) => r.isVisible);
    const visibleRoutePoints: Record<string, RoutePoint[]> = {};

    for (const route of routes) {
      visibleRoutePoints[route.id] = await getRoutePoints(route.id);
    }

    set({ visibleRoutePoints });
  },

  setSnappedPosition: (snappedPosition) => {
    const prev = get().snappedPosition;
    if (
      prev?.pointIndex === snappedPosition?.pointIndex &&
      prev?.routeId === snappedPosition?.routeId
    ) return;
    set({ snappedPosition });
  },

  clearError: () => set({ error: null }),
}));
