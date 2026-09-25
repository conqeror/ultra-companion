import { beforeEach, describe, expect, it } from "vitest";
import { usePoiStore } from "@/store/poiStore";
import { databaseMocks } from "@/tests/mocks/database";
import { buildPoi } from "@/tests/fixtures/poi";
import { toDisplayPOI } from "@/services/displayDistance";

function resetPoiStoreState() {
  usePoiStore.setState({
    pois: {},
    sourceInfo: {},
    starredPOIIds: new Set(),
    selectedPOI: null,
  });
}

describe("poiStore starred POIs", () => {
  beforeEach(() => {
    resetPoiStoreState();
  });

  it("loads starred POI ids from SQLite", async () => {
    databaseMocks.getStarredItems.mockResolvedValueOnce([
      { entityType: "poi", entityId: "poi-1", createdAt: "2026-05-05T00:00:00.000Z" },
      { entityType: "poi", entityId: "poi-2", createdAt: "2026-05-05T00:01:00.000Z" },
    ]);

    await usePoiStore.getState().loadStarredItems();

    expect(databaseMocks.getStarredItems).toHaveBeenCalledWith("poi");
    expect([...usePoiStore.getState().starredPOIIds]).toEqual(["poi-1", "poi-2"]);
  });

  it("reloads imported POIs when the retained source counts have not changed", async () => {
    const original = buildPoi("poi-1", "route-1", 500, { source: "osm" });
    databaseMocks.getPOIsForRoute.mockResolvedValueOnce([original]);
    await usePoiStore.getState().loadPOIs("route-1");
    const sourceInfo = usePoiStore.getState().sourceInfo;

    // Planner refresh clears the view cache but retains source status/counts.
    usePoiStore.setState({ pois: {}, selectedPOI: null });
    const imported = buildPoi("poi-1", "route-1", 500, {
      source: "osm",
      tags: { notes: "Refill here", planned_stop_duration_minutes: "30" },
    });
    databaseMocks.getPOIsForRoute.mockResolvedValueOnce([imported]);

    await usePoiStore.getState().loadPOIs("route-1");

    expect(usePoiStore.getState().pois["route-1"]).toEqual([imported]);
    expect(usePoiStore.getState().sourceInfo).toEqual(sourceInfo);
  });

  it("persists star toggles optimistically", async () => {
    await usePoiStore.getState().toggleStarred("poi-1");

    expect(databaseMocks.setStarredItem).toHaveBeenCalledWith("poi", "poi-1", true);
    expect(usePoiStore.getState().isStarred("poi-1")).toBe(true);

    await usePoiStore.getState().toggleStarred("poi-1");

    expect(databaseMocks.setStarredItem).toHaveBeenLastCalledWith("poi", "poi-1", false);
    expect(usePoiStore.getState().isStarred("poi-1")).toBe(false);
  });

  it("stars custom POIs by default in persistent storage", async () => {
    const poi = buildPoi("custom-1", "route-1", 500, { source: "custom" });
    databaseMocks.getPOIsForRoute.mockResolvedValueOnce([poi]);

    await usePoiStore.getState().addCustomPOI(poi);

    expect(databaseMocks.insertPOIs).toHaveBeenCalledWith([poi]);
    expect(databaseMocks.setStarredItem).toHaveBeenCalledWith("poi", "custom-1", true);
    expect(usePoiStore.getState().isStarred("custom-1")).toBe(true);
  });

  it("removes stars for cleared fetched POIs but preserves custom POI stars", async () => {
    const fetched = buildPoi("fetched-1", "route-1", 500, { source: "osm" });
    const custom = buildPoi("custom-1", "route-1", 600, { source: "custom" });
    usePoiStore.setState({
      pois: { "route-1": [fetched, custom] },
      starredPOIIds: new Set(["fetched-1", "custom-1"]),
    });
    databaseMocks.getPOIsForRoute.mockResolvedValueOnce([custom]);

    await usePoiStore.getState().clearPOIs("route-1");

    expect(databaseMocks.deletePOIsBySource).toHaveBeenCalledWith("route-1", "google", {
      deleteStarredItems: true,
    });
    expect(databaseMocks.deletePOIsBySource).toHaveBeenCalledWith("route-1", "osm", {
      deleteStarredItems: true,
    });
    expect([...usePoiStore.getState().starredPOIIds]).toEqual(["custom-1"]);
  });

  it("removes stars when clearing one fetched source", async () => {
    const osm = buildPoi("osm-1", "route-1", 500, { source: "osm" });
    const google = buildPoi("google-1", "route-1", 600, { source: "google" });
    usePoiStore.setState({
      pois: { "route-1": [osm, google] },
      starredPOIIds: new Set(["osm-1", "google-1"]),
    });
    databaseMocks.getPOIsForRoute.mockResolvedValueOnce([google]);

    await usePoiStore.getState().clearSource("route-1", "osm");

    expect(databaseMocks.deletePOIsBySource).toHaveBeenCalledWith("route-1", "osm", {
      deleteStarredItems: true,
    });
    expect([...usePoiStore.getState().starredPOIIds]).toEqual(["google-1"]);
  });

  it("updates planned stop duration tags", async () => {
    const poi = buildPoi("poi-1", "route-1", 500, { tags: { notes: "shop" } });
    const updated = buildPoi("poi-1", "route-1", 500, {
      tags: { notes: "shop", planned_stop_duration_minutes: "15" },
    });
    usePoiStore.setState({ pois: { "route-1": [poi] }, selectedPOI: toDisplayPOI(poi) });
    databaseMocks.updatePOIRiderFields.mockResolvedValueOnce(updated);

    await usePoiStore.getState().updatePlannedStopDuration("route-1", "poi-1", 15);

    expect(databaseMocks.updatePOIRiderFields).toHaveBeenCalledWith("route-1", "poi-1", {
      plannedStopDurationMinutes: 15,
    });
    expect(usePoiStore.getState().pois["route-1"]).toEqual([updated]);
    expect(usePoiStore.getState().selectedPOI?.tags.planned_stop_duration_minutes).toBe("15");
  });

  it("clears planned stop duration tags", async () => {
    const poi = buildPoi("poi-1", "route-1", 500, {
      tags: { notes: "shop", planned_stop_duration_minutes: "15" },
    });
    const updated = buildPoi("poi-1", "route-1", 500, { tags: { notes: "shop" } });
    usePoiStore.setState({ pois: { "route-1": [poi] } });
    databaseMocks.updatePOIRiderFields.mockResolvedValueOnce(updated);

    await usePoiStore.getState().updatePlannedStopDuration("route-1", "poi-1", 0);

    expect(databaseMocks.updatePOIRiderFields).toHaveBeenCalledWith("route-1", "poi-1", {
      plannedStopDurationMinutes: 0,
    });
  });

  it("uses the committed rider edit and preserves the selected collection offset", async () => {
    const stale = buildPoi("poi-1", "route-1", 500, { tags: { notes: "Old note" } });
    const updated = {
      ...stale,
      distanceAlongRouteMeters: 550,
      tags: { notes: "New note", planned_stop_duration_minutes: "30", opening_hours: "24/7" },
    };
    const selected = toDisplayPOI(stale, 2_000);
    usePoiStore.setState({ pois: { "route-1": [stale] }, selectedPOI: selected });
    databaseMocks.updatePOIRiderFields.mockResolvedValueOnce(updated);

    await usePoiStore.getState().updatePOINotes("route-1", "poi-1", "New note");

    expect(databaseMocks.updatePOIRiderFields).toHaveBeenCalledWith("route-1", "poi-1", {
      notes: "New note",
    });
    expect(usePoiStore.getState().pois["route-1"]).toEqual([updated]);
    expect(usePoiStore.getState().selectedPOI).toEqual(toDisplayPOI(updated, 2_000));
    expect(databaseMocks.getPOIsForRoute).not.toHaveBeenCalled();
  });

  it("updates a selected POI without creating a partial cold route cache", async () => {
    const poi = buildPoi("poi-1", "route-1", 500);
    usePoiStore.setState({ selectedPOI: toDisplayPOI(poi) });
    databaseMocks.updatePOIRiderFields.mockResolvedValueOnce({ ...poi, tags: { notes: "Saved" } });

    await usePoiStore.getState().updatePOINotes("route-1", "poi-1", "Saved");

    expect(usePoiStore.getState().pois["route-1"]).toBeUndefined();
    expect(usePoiStore.getState().selectedPOI?.tags.notes).toBe("Saved");
  });

  it("leaves view state unchanged when the rider edit fails", async () => {
    const poi = buildPoi("poi-1", "route-1", 500, { tags: { notes: "Keep" } });
    usePoiStore.setState({ pois: { "route-1": [poi] }, selectedPOI: toDisplayPOI(poi) });
    const before = usePoiStore.getState();
    databaseMocks.updatePOIRiderFields.mockRejectedValueOnce(new Error("Write failed"));

    await expect(usePoiStore.getState().updatePOINotes("route-1", "poi-1", "New")).rejects.toThrow(
      "Write failed",
    );

    expect(usePoiStore.getState()).toBe(before);
  });
});
