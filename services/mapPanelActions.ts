import { useClimbStore } from "@/store/climbStore";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import type { DisplayClimb, DisplayPOI, PanelTab } from "@/types";

/** Explicit navigation actions shared by map layers, charts and both panel layouts. */
export function openPOI(poi: DisplayPOI, sourceTab?: PanelTab): void {
  usePoiStore.getState().setSelectedPOI(poi);
  usePanelStore.getState().openDetail("pois", sourceTab);
}

export function closePOI(): void {
  usePoiStore.getState().setSelectedPOI(null);
  usePanelStore.getState().closeDetail();
}

export function openClimb(climb: DisplayClimb, sourceTab?: PanelTab): void {
  useClimbStore.getState().setSelectedClimb(climb);
  usePanelStore.getState().openDetail("climbs", sourceTab);
}

export function selectPanelTab(tab: PanelTab, layout: "single" | "split" = "single"): void {
  const panel = usePanelStore.getState();
  const visibleTab = layout === "split" ? panel.bottomTab : panel.panelTab;
  if (tab === "climbs" && visibleTab !== "climbs") {
    useClimbStore.getState().setSelectedClimb(null);
  }
  panel.setPanelTab(tab, layout);
}
