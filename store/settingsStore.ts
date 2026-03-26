import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { UnitSystem, MapStyle } from "@/types";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "settings" });
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

interface SettingsState {
  units: UnitSystem;
  mapStyle: MapStyle;
  setUnits: (units: UnitSystem) => void;
  setMapStyle: (style: MapStyle) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  units: (readString("units") as UnitSystem) ?? "metric",
  mapStyle: (readString("mapStyle") as MapStyle) ?? "outdoors",

  setUnits: (units) => {
    try { getStorage().set("units", units); } catch {}
    set({ units });
  },

  setMapStyle: (mapStyle) => {
    try { getStorage().set("mapStyle", mapStyle); } catch {}
    set({ mapStyle });
  },
}));
