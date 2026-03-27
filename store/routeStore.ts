import { create } from "zustand";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
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
import type { Route, RouteWithPoints, RoutePoint, SnappedPosition } from "@/types";

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
  deleteRoute: (id: string) => Promise<void>;
  toggleVisibility: (id: string) => Promise<void>;
  setActiveRoute: (id: string) => Promise<void>;
  getRouteDetail: (id: string) => Promise<RouteWithPoints | null>;
  loadVisibleRoutePoints: () => Promise<void>;
  setSnappedPosition: (pos: SnappedPosition | null) => void;
  clearError: () => void;
}

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
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
      const ext = fileName.toLowerCase().split(".").pop();

      if (!["gpx", "kml"].includes(ext || "")) {
        set({ isLoading: false, error: "Unsupported file type. Use .gpx or .kml files." });
        return;
      }

      const file = new File(asset.uri);
      const content = await file.text();

      const parsed = ext === "gpx"
        ? parseGPX(content, fileName)
        : parseKML(content, fileName);

      const routes = get().routes;

      const route: Route = {
        id: generateId(),
        name: parsed.name,
        fileName,
        color: INACTIVE_ROUTE_COLOR,
        isActive: routes.length === 0, // First route is active by default
        isVisible: true,
        totalDistanceMeters: parsed.totalDistanceMeters,
        totalAscentMeters: parsed.totalAscentMeters,
        totalDescentMeters: parsed.totalDescentMeters,
        pointCount: parsed.points.length,
        createdAt: new Date().toISOString(),
      };

      await insertRoute(route, parsed.points);
      set({ isLoading: false });
      await get().loadRoutes();
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
