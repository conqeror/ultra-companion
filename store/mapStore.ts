import { create } from "zustand";
import { DEFAULT_MAP_CENTER } from "@/constants";
import { requestLocationPermission, getCurrentPosition } from "@/services/gps";
import type { UserPosition } from "@/types";

interface MapState {
  center: [number, number]; // [longitude, latitude] — Mapbox convention
  followUser: boolean;
  userPosition: UserPosition | null;
  isRefreshing: boolean;

  setCenter: (center: [number, number]) => void;
  setFollowUser: (follow: boolean) => void;
  setUserPosition: (position: UserPosition | null) => void;
  refreshPosition: () => Promise<UserPosition | null>;
}

export const useMapStore = create<MapState>((set, get) => ({
  center: [DEFAULT_MAP_CENTER.longitude, DEFAULT_MAP_CENTER.latitude],
  followUser: true,
  userPosition: null,
  isRefreshing: false,

  setCenter: (center) => set({ center }),
  setFollowUser: (followUser) => set({ followUser }),
  setUserPosition: (userPosition) => set({ userPosition }),

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
