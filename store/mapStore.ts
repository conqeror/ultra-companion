import { create } from "zustand";
import { DEFAULT_MAP_CENTER, DEFAULT_ZOOM } from "@/constants";
import type { UserPosition } from "@/types";

interface MapState {
  center: [number, number]; // [longitude, latitude] — Mapbox convention
  followUser: boolean;
  userPosition: UserPosition | null;

  setCenter: (center: [number, number]) => void;
  setFollowUser: (follow: boolean) => void;
  setUserPosition: (position: UserPosition | null) => void;
}

export const useMapStore = create<MapState>((set) => ({
  center: [DEFAULT_MAP_CENTER.longitude, DEFAULT_MAP_CENTER.latitude],
  followUser: true,
  userPosition: null,

  setCenter: (center) => set({ center }),
  setFollowUser: (followUser) => set({ followUser }),
  setUserPosition: (userPosition) => set({ userPosition }),
}));
