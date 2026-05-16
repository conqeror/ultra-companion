import { create } from "zustand";
import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import { DEFAULT_MAP_CENTER, DEFAULT_ZOOM } from "@/constants";
import { requestLocationPermission, getCurrentPosition } from "@/services/gps";
import type { POIMapVisibility, UserPosition } from "@/types";

let storage: KeyValueStorage | null = null;
function getStorage(): KeyValueStorage {
  if (!storage) storage = createKeyValueStorage("map-camera");
  return storage;
}

function readPersistedCamera(): { center: [number, number]; zoom: number } {
  try {
    const raw = getStorage().getString("camera");
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    center: [DEFAULT_MAP_CENTER.longitude, DEFAULT_MAP_CENTER.latitude],
    zoom: DEFAULT_ZOOM,
  };
}

function readPersistedBoolean(key: string, defaultValue: boolean): boolean {
  try {
    const raw = getStorage().getString(key);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {}
  return defaultValue;
}

function persistBoolean(key: string, value: boolean): void {
  try {
    getStorage().set(key, String(value));
  } catch {}
}

function readPersistedPOIVisibility(): POIMapVisibility {
  try {
    const raw = getStorage().getString("poiVisibility");
    if (raw === "none" || raw === "starred" || raw === "all") return raw;
    const legacy = getStorage().getString("showPOIs");
    if (legacy === "false") return "none";
  } catch {}
  return "starred";
}

function persistPOIVisibility(value: POIMapVisibility): void {
  try {
    getStorage().set("poiVisibility", value);
  } catch {}
}

interface MapState {
  center: [number, number]; // [longitude, latitude] — Mapbox convention
  zoom: number;
  followUser: boolean;
  showDistanceMarkers: boolean;
  poiVisibility: POIMapVisibility;
  userPosition: UserPosition | null;
  isRefreshing: boolean;

  setCenter: (center: [number, number]) => void;
  setFollowUser: (follow: boolean) => void;
  toggleDistanceMarkers: () => void;
  cyclePOIVisibility: () => void;
  setUserPosition: (position: UserPosition | null) => void;
  refreshPosition: () => Promise<UserPosition | null>;
  persistCamera: (center: [number, number], zoom: number) => void;
}

const persisted = readPersistedCamera();

export const useMapStore = create<MapState>((set, get) => ({
  center: persisted.center,
  zoom: persisted.zoom,
  followUser: true,
  showDistanceMarkers: readPersistedBoolean("showDistanceMarkers", false),
  poiVisibility: readPersistedPOIVisibility(),
  userPosition: null,
  isRefreshing: false,

  setCenter: (center) => set({ center }),
  setFollowUser: (followUser) => set({ followUser }),
  toggleDistanceMarkers: () => {
    const showDistanceMarkers = !get().showDistanceMarkers;
    persistBoolean("showDistanceMarkers", showDistanceMarkers);
    set({ showDistanceMarkers });
  },
  cyclePOIVisibility: () => {
    const current = get().poiVisibility;
    const poiVisibility: POIMapVisibility =
      current === "none" ? "starred" : current === "starred" ? "all" : "none";
    persistPOIVisibility(poiVisibility);
    set({ poiVisibility });
  },
  setUserPosition: (userPosition) => set({ userPosition }),

  persistCamera: (center, zoom) => {
    set({ center, zoom });
    try {
      getStorage().set("camera", JSON.stringify({ center, zoom }));
    } catch {}
  },

  refreshPosition: async () => {
    if (get().isRefreshing) return null;
    set({ isRefreshing: true });
    try {
      const granted = await requestLocationPermission();
      if (!granted) return null;
      const position = await getCurrentPosition();
      if (position) {
        set({ userPosition: position });
      }
      return position;
    } finally {
      set({ isRefreshing: false });
    }
  },
}));
