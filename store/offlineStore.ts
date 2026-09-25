import { create } from "zustand";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import type { OfflineRouteInfo, OfflineRoutePack, RoutePoint } from "@/types";
import { poiDiscoveryCategoriesForSource } from "@/constants";
import { getFerryCrossingsForRoute, getPOICountsBySource, getRoute } from "@/db/database";
import {
  downloadRouteTiles,
  deleteRoutePacks,
  getAllRoutePacks,
  estimateDownloadSize,
} from "@/services/offlineTiles";

let storage: KeyValueStorage | null = null;

function getStorage(): KeyValueStorage {
  if (!storage) {
    storage = createKeyValueStorage("offline");
  }
  return storage;
}

function readRouteInfo(): Record<string, OfflineRouteInfo> {
  try {
    const raw = getStorage().getString("routeInfo");
    if (raw) {
      const info = JSON.parse(raw) as Record<string, OfflineRouteInfo>;
      for (const entry of Object.values(info)) {
        if (entry.status === "downloading") {
          entry.status = "error";
          entry.error = "Download was interrupted. Please retry.";
        } else if (entry.status === "complete" && entry.readinessVersion !== 1) {
          entry.status = "error";
          entry.error = "Offline map resources need verification. Please retry if incomplete.";
        }
      }
      return info;
    }
  } catch {}
  return {};
}

function persistRouteInfo(info: Record<string, OfflineRouteInfo>): void {
  try {
    getStorage().set("routeInfo", JSON.stringify(info));
  } catch {}
}

const DEFAULT_ROUTE_INFO: OfflineRouteInfo = {
  status: "idle",
  percentage: 0,
  downloadedBytes: 0,
  estimatedBytes: 0,
  downloadedAt: null,
  error: null,
};

interface OfflineState {
  routeInfo: Record<string, OfflineRouteInfo>;
  isConnected: boolean;

  // Actions
  startTileDownload: (routeId: string, points: RoutePoint[]) => Promise<void>;
  prepareRouteOffline: (routeId: string, points: RoutePoint[]) => Promise<void>;
  cancelDownload: (routeId: string) => Promise<void>;
  deleteOfflineData: (routeId: string) => Promise<void>;
  refreshAllStatuses: () => Promise<void>;
  initConnectivityListener: () => () => void;

  // Helpers
  getRouteInfo: (routeId: string) => OfflineRouteInfo;
  isRouteOfflineReady: (routeId: string) => boolean;
  getTotalStorageBytes: () => number;
}

const downloadGenerations = new Map<string, number>();
const activeDownloads = new Map<string, number>();
let statusRefreshGeneration = 0;

function nextDownloadGeneration(routeId: string): number {
  const next = (downloadGenerations.get(routeId) ?? 0) + 1;
  downloadGenerations.set(routeId, next);
  return next;
}

function isCurrentDownload(routeId: string, generation: number): boolean {
  return downloadGenerations.get(routeId) === generation;
}

async function ensureRouteETAForOffline(routeId: string, points: RoutePoint[]): Promise<void> {
  if (points.length === 0) return;

  try {
    const [{ useEtaStore }, route, ferries] = await Promise.all([
      import("@/store/etaStore"),
      getRoute(routeId).catch((error) => {
        console.warn(`Failed to read route metadata before ETA prep for ${routeId}:`, error);
        return null;
      }),
      getFerryCrossingsForRoute(routeId).catch(() => []),
    ]);
    const lastPoint = points[points.length - 1];
    await useEtaStore.getState().ensureRelativeETA({
      scope: "route",
      scopeId: routeId,
      points,
      totalDistanceMeters: route?.totalDistanceMeters ?? lastPoint.distanceFromStartMeters,
      totalAscentMeters: route?.totalAscentMeters ?? null,
      totalDescentMeters: route?.totalDescentMeters ?? null,
      ferries,
    });
  } catch (error) {
    console.warn(`Failed to prepare ETA cache for route ${routeId}:`, error);
  }
}

export const useOfflineStore = create<OfflineState>((set, get) => ({
  routeInfo: readRouteInfo(),
  isConnected: true,

  getRouteInfo: (routeId) => {
    return get().routeInfo[routeId] ?? DEFAULT_ROUTE_INFO;
  },

  isRouteOfflineReady: (routeId) => {
    const info = get().routeInfo[routeId];
    return info?.status === "complete";
  },

  getTotalStorageBytes: () => {
    const all = get().routeInfo;
    let total = 0;
    for (const info of Object.values(all)) {
      if (info.status === "complete") total += info.downloadedBytes;
    }
    return total;
  },

  startTileDownload: async (routeId, points) => {
    if (get().routeInfo[routeId]?.status === "downloading") return;

    const generation = nextDownloadGeneration(routeId);
    activeDownloads.set(routeId, generation);
    const estimated = estimateDownloadSize(points);

    // Persist-and-set helper for non-progress updates
    const updateInfo = (partial: Partial<OfflineRouteInfo>) => {
      if (!isCurrentDownload(routeId, generation)) return;
      set((s) => {
        const updated = {
          ...s.routeInfo,
          [routeId]: { ...(s.routeInfo[routeId] ?? DEFAULT_ROUTE_INFO), ...partial },
        };
        persistRouteInfo(updated);
        return { routeInfo: updated };
      });
    };

    updateInfo({
      status: "downloading",
      percentage: 0,
      downloadedBytes: 0,
      estimatedBytes: estimated,
      error: null,
    });

    // Throttled progress: update store at most every 500ms, skip MMKV persist
    let lastProgressUpdate = 0;
    try {
      await downloadRouteTiles(
        routeId,
        points,
        (percentage, completedBytes) => {
          if (!isCurrentDownload(routeId, generation)) return;
          const now = Date.now();
          if (now - lastProgressUpdate < 500) return;
          lastProgressUpdate = now;
          const current = get().routeInfo[routeId];
          if (current?.status !== "downloading") return;
          set((s) => ({
            routeInfo: {
              ...s.routeInfo,
              [routeId]: {
                ...(s.routeInfo[routeId] ?? DEFAULT_ROUTE_INFO),
                percentage,
                downloadedBytes: completedBytes,
              },
            },
          }));
        },
        (completedBytes) => {
          updateInfo({
            status: "complete",
            percentage: 100,
            downloadedBytes: completedBytes,
            downloadedAt: new Date().toISOString(),
            readinessVersion: 1,
            error: null,
          });
        },
        (error) => {
          updateInfo({ status: "error", error });
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      updateInfo({ status: "error", error: message });
    } finally {
      if (activeDownloads.get(routeId) === generation) activeDownloads.delete(routeId);
    }
  },

  prepareRouteOffline: async (routeId, points) => {
    const { usePoiStore } = await import("@/store/poiStore");
    const poiStore = usePoiStore.getState();
    let counts = { osm: 0, google: 0 };

    await ensureRouteETAForOffline(routeId, points);

    try {
      counts = await getPOICountsBySource(routeId);
    } catch (error) {
      console.warn("Failed to read POI counts before offline preparation:", error);
    }

    const fetchIfMissing = async (source: "google" | "osm", count: number) => {
      if (poiDiscoveryCategoriesForSource(poiStore.discoveryCategories, source).length === 0) {
        return;
      }
      if (count > 0) return;
      try {
        await poiStore.fetchSource(routeId, source, points);
      } catch (error) {
        console.warn(`Failed to prepare ${source} POIs for route ${routeId}:`, error);
      }
    };

    // Keep source failures scoped. A Google API error should not prevent OSM
    // from fetching or map tiles from starting.
    await fetchIfMissing("google", counts.google);
    await fetchIfMissing("osm", counts.osm);

    const info = get().routeInfo[routeId];
    if (info?.status === "complete" || info?.status === "downloading") return;
    await get().startTileDownload(routeId, points);
  },

  cancelDownload: async (routeId) => {
    nextDownloadGeneration(routeId);
    await deleteRoutePacks(routeId);
    set((s) => {
      const updated = { ...s.routeInfo };
      delete updated[routeId];
      persistRouteInfo(updated);
      return { routeInfo: updated };
    });
  },

  deleteOfflineData: async (routeId) => {
    nextDownloadGeneration(routeId);
    await deleteRoutePacks(routeId);
    set((s) => {
      const updated = { ...s.routeInfo };
      delete updated[routeId];
      persistRouteInfo(updated);
      return { routeInfo: updated };
    });
  },

  refreshAllStatuses: async () => {
    const refreshGeneration = ++statusRefreshGeneration;
    const generationsAtStart = new Map(downloadGenerations);
    const activeAtStart = new Set(activeDownloads.keys());
    let routePacks: OfflineRoutePack[];
    try {
      routePacks = await getAllRoutePacks();
    } catch (error) {
      // An unavailable inventory is not evidence that resources were deleted.
      console.warn("Failed to check offline map resources:", error);
      return;
    }
    if (refreshGeneration !== statusRefreshGeneration) return;

    const changedDuringRefresh = (routeId: string) =>
      activeAtStart.has(routeId) ||
      activeDownloads.has(routeId) ||
      generationsAtStart.get(routeId) !== downloadGenerations.get(routeId);
    const current = get().routeInfo;
    const updated = { ...current };
    let changed = false;

    for (const pack of routePacks) {
      if (changedDuringRefresh(pack.routeId)) continue;
      const existing = updated[pack.routeId] ?? DEFAULT_ROUTE_INFO;
      const tilesComplete =
        pack.requiredResourceCount > 0 &&
        pack.completedResourceCount === pack.requiredResourceCount;
      const complete = tilesComplete && pack.stylePackComplete;
      const next: OfflineRouteInfo = {
        ...existing,
        status: complete ? "complete" : "error",
        percentage: complete
          ? 100
          : pack.requiredResourceCount > 0
            ? Math.min(99, (pack.completedResourceCount / pack.requiredResourceCount) * 100)
            : 0,
        downloadedBytes: pack.totalBytes,
        downloadedAt: complete ? (existing.downloadedAt ?? new Date().toISOString()) : null,
        readinessVersion: complete ? 1 : undefined,
        error: complete
          ? null
          : tilesComplete
            ? "Offline map style resources are missing or incomplete. Please retry."
            : "Map tile download is incomplete. Please retry.",
      };
      if (JSON.stringify(next) !== JSON.stringify(updated[pack.routeId])) {
        updated[pack.routeId] = next;
        changed = true;
      }
    }

    // Remove orphaned entries (MMKV says downloaded but Mapbox has no packs)
    const packRouteIds = new Set(routePacks.map((p) => p.routeId));
    for (const routeId of Object.keys(updated)) {
      if (
        !changedDuringRefresh(routeId) &&
        updated[routeId].status !== "idle" &&
        !packRouteIds.has(routeId)
      ) {
        delete updated[routeId];
        changed = true;
      }
    }

    if (changed) {
      persistRouteInfo(updated);
      set({ routeInfo: updated });
    }
  },

  initConnectivityListener: () => {
    getNetworkStateAsync()
      .then((state) => {
        set({ isConnected: state.isConnected ?? true });
      })
      .catch(() => {});

    const subscription = addNetworkStateListener((event) => {
      set({ isConnected: event.isConnected ?? true });
    });

    return () => subscription.remove();
  },
}));
