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

export type BottomSheet = "poi" | "weather" | "climb" | null;

interface PanelState {
  panelMode: PanelMode;
  cyclePanelMode: () => void;
  setPanelMode: (mode: PanelMode) => void;

  /** Which overlay sheet is active — only one at a time */
  bottomSheet: BottomSheet;
  setBottomSheet: (sheet: BottomSheet) => void;
  toggleBottomSheet: (sheet: "poi" | "weather") => void;
}

const DEFAULT_PANEL_MODE: PanelMode = "upcoming-50";

function readPanelMode(): PanelMode {
  const raw = readString("panelMode");
  if (raw && (PANEL_MODES as readonly string[]).includes(raw)) return raw as PanelMode;
  return DEFAULT_PANEL_MODE;
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panelMode: readPanelMode(),

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

  bottomSheet: null,

  setBottomSheet: (sheet) => set({ bottomSheet: sheet }),

  toggleBottomSheet: (sheet) => {
    set((s) => ({ bottomSheet: s.bottomSheet === sheet ? null : sheet }));
  },
}));
