import { create } from "zustand";
import { createMMKV, type MMKV } from "react-native-mmkv";
import type { PanelMode, PanelTab } from "@/types";
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

  /** Which tab is active in the bottom panel */
  panelTab: PanelTab;
  setPanelTab: (tab: PanelTab) => void;

  /** Whether the bottom sheet is in expanded mode */
  isExpanded: boolean;
  setIsExpanded: (isExpanded: boolean) => void;
}

const DEFAULT_PANEL_MODE: PanelMode = "upcoming-50";

const PANEL_TABS: ReadonlySet<PanelTab> = new Set(["profile", "weather", "climbs", "pois"]);

function readPanelMode(): PanelMode {
  const raw = readString("panelMode");
  if (raw && (PANEL_MODES as readonly string[]).includes(raw)) return raw as PanelMode;
  return DEFAULT_PANEL_MODE;
}

function readPanelTab(): PanelTab {
  const raw = readString("panelTab");
  if (raw && PANEL_TABS.has(raw as PanelTab)) return raw as PanelTab;
  return "profile";
}

export const usePanelStore = create<PanelState>((set, get) => ({
  panelMode: readPanelMode(),

  cyclePanelMode: () => {
    const current = get().panelMode;
    const idx = PANEL_MODES.indexOf(current);
    const next = PANEL_MODES[(idx + 1) % PANEL_MODES.length];
    try {
      getStorage().set("panelMode", next);
    } catch {}
    set({ panelMode: next });
  },

  setPanelMode: (panelMode) => {
    try {
      getStorage().set("panelMode", panelMode);
    } catch {}
    set({ panelMode });
  },

  panelTab: readPanelTab(),

  setPanelTab: (panelTab) => {
    try {
      getStorage().set("panelTab", panelTab);
    } catch {}
    set({ panelTab });
  },

  isExpanded: false,
  setIsExpanded: (isExpanded) => {
    if (get().isExpanded === isExpanded) return;
    set({ isExpanded });
  },
}));
