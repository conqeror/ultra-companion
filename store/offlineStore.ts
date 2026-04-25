import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import { addNetworkStateListener, getNetworkStateAsync } from "expo-network";
import type { OfflineRouteInfo, RoutePoint } from "@/types";
import { getPOICountsBySource } from "@/db/database";
import {
  downloadRouteTiles,
  deleteRoutePacks,
  getAllRoutePacks,
  estimateDownloadSize,
} from "@/services/offlineTiles";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "offline" });
  }
  return storage;
}

function readRouteInfo(): Record<string, OfflineRouteInfo> {
  try {
    const raw = getStorage().getString("routeInfo");
    if (raw) return JSON.parse(raw);
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

function nextDownloadGeneration(routeId: string): number {
  const next = (downloadGenerations.get(routeId) ?? 0) + 1;
  downloadGenerations.set(routeId, next);
  return next;
}

function isCurrentDownload(routeId: string, generation: number): boolean {
  return downloadGenerations.get(routeId) === generation;
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
        () => {
          updateInfo({
            status: "complete",
            percentage: 100,
            downloadedAt: new Date().toISOString(),
          });
        },
        (error) => {
          updateInfo({ status: "error", error });
        },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Download failed";
      updateInfo({ status: "error", error: message });
    }
  },

  prepareRouteOffline: async (routeId, points) => {
    const { usePoiStore } = await import("@/store/poiStore");
    const poiStore = usePoiStore.getState();
    let counts = { osm: 0, google: 0 };

    try {
      counts = await getPOICountsBySource(routeId);
    } catch (error) {
      console.warn("Failed to read POI counts before offline preparation:", error);
    }

    const fetchIfMissing = async (source: "google" | "osm", count: number) => {
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
    const routePacks = await getAllRoutePacks();
    const current = get().routeInfo;
    const updated = { ...current };
    let changed = false;

    for (const pack of routePacks) {
      const existing = updated[pack.routeId];
      if (existing?.status === "downloading" || existing?.status === "error") {
        updated[pack.routeId] = {
          ...existing,
          status: "complete",
          percentage: 100,
          downloadedBytes: pack.totalBytes,
          downloadedAt: new Date().toISOString(),
        };
        changed = true;
      } else if (existing?.status === "complete" && existing.downloadedBytes !== pack.totalBytes) {
        updated[pack.routeId] = { ...existing, downloadedBytes: pack.totalBytes };
        changed = true;
      }
    }

    // Remove orphaned entries (MMKV says downloaded but Mapbox has no packs)
    const packRouteIds = new Set(routePacks.map((p) => p.routeId));
    for (const routeId of Object.keys(updated)) {
      if (updated[routeId].status !== "idle" && !packRouteIds.has(routeId)) {
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
