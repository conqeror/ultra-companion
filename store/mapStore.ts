import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import { DEFAULT_MAP_CENTER, DEFAULT_ZOOM } from "@/constants";
import { requestLocationPermission, getCurrentPosition } from "@/services/gps";
import type { UserPosition } from "@/types";

let storage: MMKV | null = null;
function getStorage(): MMKV {
  if (!storage) storage = createMMKV({ id: "map-camera" });
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

interface MapState {
  center: [number, number]; // [longitude, latitude] — Mapbox convention
  zoom: number;
  followUser: boolean;
  showDistanceMarkers: boolean;
  showPOIs: boolean;
  userPosition: UserPosition | null;
  isRefreshing: boolean;

  setCenter: (center: [number, number]) => void;
  setFollowUser: (follow: boolean) => void;
  toggleDistanceMarkers: () => void;
  togglePOIs: () => void;
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
  showPOIs: readPersistedBoolean("showPOIs", true),
  userPosition: null,
  isRefreshing: false,

  setCenter: (center) => set({ center }),
  setFollowUser: (followUser) => set({ followUser }),
  toggleDistanceMarkers: () => {
    const showDistanceMarkers = !get().showDistanceMarkers;
    persistBoolean("showDistanceMarkers", showDistanceMarkers);
    set({ showDistanceMarkers });
  },
  togglePOIs: () => {
    const showPOIs = !get().showPOIs;
    persistBoolean("showPOIs", showPOIs);
    set({ showPOIs });
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
