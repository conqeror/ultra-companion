import { beforeEach, describe, expect, it } from "vitest";
import { usePanelStore } from "@/store/panelStore";
import { usePoiStore } from "@/store/poiStore";
import { useClimbStore } from "@/store/climbStore";
import { closePOI, openClimb, openPOI, selectPanelTab } from "@/services/mapPanelActions";
import { toDisplayClimb, toDisplayPOI } from "@/services/displayDistance";
import { buildPoi } from "@/tests/fixtures/poi";
import { buildClimb } from "@/tests/fixtures/climb";

const poi = toDisplayPOI(buildPoi("p1", "r1", 100));
const nextPOI = toDisplayPOI(buildPoi("p2", "r1", 200));

beforeEach(() => {
  usePanelStore.setState({
    panelTab: "profile",
    bottomTab: "profile",
    sidebarTab: "upcoming",
    detailReturn: null,
  });
  usePoiStore.setState({ selectedPOI: null });
  useClimbStore.setState({ selectedClimb: null });
});

describe("map panel navigation", () => {
  it("keeps data selection independent of navigation", () => {
    usePoiStore.getState().setSelectedPOI(poi);
    expect(usePanelStore.getState().panelTab).toBe("profile");
    expect(usePanelStore.getState().detailReturn).toBeNull();
  });

  it("opens POIs in the web sidebar without resetting the visible bottom panel", () => {
    selectPanelTab("climbs");
    selectPanelTab("upcoming");
    openPOI(poi, "upcoming");
    expect(usePanelStore.getState()).toMatchObject({
      panelTab: "pois",
      bottomTab: "climbs",
      sidebarTab: "pois",
    });
    closePOI();
    expect(usePoiStore.getState().selectedPOI).toBeNull();
    expect(usePanelStore.getState()).toMatchObject({
      panelTab: "upcoming",
      bottomTab: "climbs",
      sidebarTab: "upcoming",
      detailReturn: null,
    });
  });

  it("retains the original return target when selecting another POI inside details", () => {
    openPOI(poi, "profile");
    openPOI(nextPOI, "pois");
    expect(usePoiStore.getState().selectedPOI?.id).toBe("p2");
    closePOI();
    expect(usePanelStore.getState().panelTab).toBe("profile");
  });

  it("manual tab navigation abandons an old detail return target", () => {
    openPOI(poi, "profile");
    selectPanelTab("upcoming");
    selectPanelTab("pois");
    closePOI();
    expect(usePanelStore.getState().panelTab).toBe("pois");
  });

  it("opens an explicit climb but resets selection when entering the climb tab manually", () => {
    const climb = toDisplayClimb(buildClimb("c1", "r1", 100, 500));
    openClimb(climb, "upcoming");
    expect(useClimbStore.getState().selectedClimb).toEqual(climb);
    expect(usePanelStore.getState().bottomTab).toBe("climbs");
    selectPanelTab("profile");
    selectPanelTab("climbs");
    expect(useClimbStore.getState().selectedClimb).toBeNull();
  });

  it("keeps the selected climb when reselecting its visible bottom tab after sidebar navigation", () => {
    const climb = toDisplayClimb(buildClimb("c1", "r1", 100, 500));
    openClimb(climb, "upcoming");
    selectPanelTab("pois", "split");
    expect(usePanelStore.getState().bottomTab).toBe("climbs");
    selectPanelTab("climbs", "split");
    expect(useClimbStore.getState().selectedClimb).toEqual(climb);
    expect(usePanelStore.getState().sidebarTab).toBe("pois");
  });

  it("preserves the sidebar Back target while retaining a newly selected bottom tab", () => {
    openPOI(poi, "upcoming");
    selectPanelTab("climbs", "split");
    expect(usePanelStore.getState().sidebarTab).toBe("pois");
    expect(usePoiStore.getState().selectedPOI).toEqual(poi);
    closePOI();
    expect(usePanelStore.getState()).toMatchObject({
      panelTab: "upcoming",
      sidebarTab: "upcoming",
      bottomTab: "climbs",
      detailReturn: null,
    });
    expect(usePoiStore.getState().selectedPOI).toBeNull();
  });

  it("still abandons the sidebar Back target when explicitly navigating that sidebar", () => {
    openPOI(poi, "upcoming");
    selectPanelTab("upcoming", "split");
    selectPanelTab("pois", "split");
    closePOI();
    expect(usePanelStore.getState()).toMatchObject({
      panelTab: "pois",
      sidebarTab: "pois",
      detailReturn: null,
    });
  });

  it("keeps the return source aligned with its visible region across consecutive POI details", () => {
    openPOI(poi, "profile");
    selectPanelTab("climbs", "split");
    closePOI();
    expect(usePanelStore.getState().bottomTab).toBe("climbs");

    // A map marker uses the current panel as its implicit return source.
    openPOI(nextPOI);
    closePOI();
    expect(usePanelStore.getState()).toMatchObject({
      panelTab: "climbs",
      bottomTab: "climbs",
      sidebarTab: "upcoming",
      detailReturn: null,
    });
  });
});
