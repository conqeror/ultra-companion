import { create } from "zustand";
import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import type { PanelMode, PanelTab } from "@/types";
import { PANEL_MODES } from "@/constants";

let storage: KeyValueStorage | null = null;

function getStorage(): KeyValueStorage {
  if (!storage) {
    storage = createKeyValueStorage("panel");
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

type PanelScrollList = "upcoming" | "pois";
type PanelScrollOffsets = Record<PanelScrollList, Record<string, number>>;

const EMPTY_SCROLL_OFFSETS: PanelScrollOffsets = {
  upcoming: {},
  pois: {},
};

function readPanelScrollOffsets(): PanelScrollOffsets {
  const raw = readString("panelScrollOffsets");
  if (!raw) return EMPTY_SCROLL_OFFSETS;

  try {
    const parsed = JSON.parse(raw) as Partial<PanelScrollOffsets>;
    return {
      upcoming: sanitizeScrollOffsets(parsed.upcoming),
      pois: sanitizeScrollOffsets(parsed.pois),
    };
  } catch {
    return EMPTY_SCROLL_OFFSETS;
  }
}

function sanitizeScrollOffsets(offsets: unknown): Record<string, number> {
  if (!offsets || typeof offsets !== "object") return {};

  const sanitized: Record<string, number> = {};
  for (const [key, value] of Object.entries(offsets)) {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function persistPanelScrollOffsets(offsets: PanelScrollOffsets) {
  try {
    getStorage().set("panelScrollOffsets", JSON.stringify(offsets));
  } catch {}
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

  /** Tab to return to when closing a detail view opened from another tab */
  detailReturnTab: PanelTab | null;
  setDetailReturnTab: (tab: PanelTab | null) => void;
  consumeDetailReturnTab: () => PanelTab | null;

  /** Last visible list offsets, keyed by route/filter context */
  panelScrollOffsets: PanelScrollOffsets;
  getPanelScrollOffset: (list: PanelScrollList, key: string) => number;
  setPanelScrollOffset: (list: PanelScrollList, key: string, offset: number) => void;
}

const DEFAULT_PANEL_MODE: PanelMode = "upcoming-50";

const PANEL_TABS: ReadonlySet<PanelTab> = new Set([
  "profile",
  "upcoming",
  "weather",
  "climbs",
  "pois",
]);

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

  detailReturnTab: null,
  setDetailReturnTab: (detailReturnTab) => {
    if (get().detailReturnTab === detailReturnTab) return;
    set({ detailReturnTab });
  },
  consumeDetailReturnTab: () => {
    const tab = get().detailReturnTab;
    if (tab) set({ detailReturnTab: null });
    return tab;
  },

  panelScrollOffsets: readPanelScrollOffsets(),
  getPanelScrollOffset: (list, key) => get().panelScrollOffsets[list][key] ?? 0,
  setPanelScrollOffset: (list, key, offset) => {
    const scrollOffset = Math.max(0, offset);
    const current = get().panelScrollOffsets[list][key] ?? 0;
    if (Math.abs(current - scrollOffset) < 1) return;

    const next = {
      ...get().panelScrollOffsets,
      [list]: {
        ...get().panelScrollOffsets[list],
        [key]: scrollOffset,
      },
    };
    persistPanelScrollOffsets(next);
    set({ panelScrollOffsets: next });
  },
}));
