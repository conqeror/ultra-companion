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
  setPanelTab: (tab: PanelTab, layout?: "single" | "split") => void;
  /** Web displays these two regions simultaneously. */
  bottomTab: "profile" | "climbs";
  sidebarTab: "upcoming" | "pois";

  /** Whether the bottom sheet is in expanded mode */
  isExpanded: boolean;
  setIsExpanded: (isExpanded: boolean) => void;

  /** Tab to return to when closing a detail view opened from another tab */
  detailReturn:
    | (Pick<PanelState, "panelTab" | "bottomTab" | "sidebarTab"> & {
        detailTab: "pois" | "climbs";
      })
    | null;
  openDetail: (tab: "pois" | "climbs", sourceTab?: PanelTab) => void;
  closeDetail: () => void;

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

function navigationForTab(tab: PanelTab) {
  try {
    getStorage().set("panelTab", tab);
  } catch {}
  return {
    panelTab: tab,
    ...(tab === "profile" || tab === "climbs" ? { bottomTab: tab } : {}),
    ...(tab === "upcoming" || tab === "pois" ? { sidebarTab: tab } : {}),
  };
}

const initialTab = readPanelTab();

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

  panelTab: initialTab,
  bottomTab: initialTab === "climbs" ? "climbs" : "profile",
  sidebarTab: initialTab === "pois" ? "pois" : "upcoming",
  setPanelTab: (tab, layout = "single") => {
    const origin = get().detailReturn;
    const isBottom = tab === "profile" || tab === "climbs";
    const changesOtherRegion = origin && (origin.detailTab === "climbs") !== isBottom;
    const sourceIsBottom = origin?.panelTab === "profile" || origin?.panelTab === "climbs";
    let detailReturn: PanelState["detailReturn"] = null;
    if (layout === "split" && origin && changesOtherRegion) {
      // The other web pane stays independent, including when Back restores this detail's source.
      detailReturn = { ...origin };
      if (sourceIsBottom === isBottom) detailReturn.panelTab = tab;
      if (isBottom) detailReturn.bottomTab = tab;
      else if (tab === "pois" || tab === "upcoming") detailReturn.sidebarTab = tab;
    }
    set({ ...navigationForTab(tab), detailReturn });
  },

  isExpanded: false,
  setIsExpanded: (isExpanded) => {
    if (get().isExpanded === isExpanded) return;
    set({ isExpanded });
  },

  detailReturn: null,
  openDetail: (tab, sourceTab) => {
    const state = get();
    const source = sourceTab ?? state.panelTab;
    const origin = {
      detailTab: tab,
      panelTab: source,
      bottomTab: source === "profile" || source === "climbs" ? source : state.bottomTab,
      sidebarTab: source === "upcoming" || source === "pois" ? source : state.sidebarTab,
    };
    set({
      ...navigationForTab(tab),
      detailReturn: source === tab ? state.detailReturn : origin,
    });
  },
  closeDetail: () => {
    const origin = get().detailReturn;
    if (origin) {
      const { panelTab, bottomTab, sidebarTab } = origin;
      navigationForTab(panelTab);
      set({ panelTab, bottomTab, sidebarTab, detailReturn: null });
    } else {
      set({ detailReturn: null });
    }
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
