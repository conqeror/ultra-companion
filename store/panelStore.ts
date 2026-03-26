import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { PanelMode } from "@/types";
import { PANEL_MODES } from "@/constants";

let storage: MMKV | null = null;

function getStorage(): MMKV {
  if (!storage) {
    storage = createMMKV({ id: "panel" });
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

interface PanelState {
  panelMode: PanelMode;
  cyclePanelMode: () => void;
  setPanelMode: (mode: PanelMode) => void;
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panelMode: (readString("panelMode") as PanelMode) ?? "none",

  cyclePanelMode: () => {
    const current = get().panelMode;
    const idx = PANEL_MODES.indexOf(current);
    const next = PANEL_MODES[(idx + 1) % PANEL_MODES.length];
    try { getStorage().set("panelMode", next); } catch {}
    set({ panelMode: next });
  },

  setPanelMode: (panelMode) => {
    try { getStorage().set("panelMode", panelMode); } catch {}
    set({ panelMode });
  },
}));
