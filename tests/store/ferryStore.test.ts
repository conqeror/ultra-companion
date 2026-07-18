import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFerryStore } from "@/store/ferryStore";
import { databaseMocks } from "@/tests/mocks/database";
import type { FerryCrossing } from "@/types";

const etaMocks = vi.hoisted(() => ({ invalidateCache: vi.fn() }));

vi.mock("@/store/etaStore", () => ({
  useEtaStore: {
    getState: () => ({ invalidateCache: etaMocks.invalidateCache }),
  },
}));

function ferry(overrides: Partial<FerryCrossing> = {}): FerryCrossing {
  return {
    id: "ferry-1",
    routeId: "route-1",
    name: "Harbor ferry",
    startDistanceMeters: 1_000,
    endDistanceMeters: 3_000,
    startLatitude: 60,
    startLongitude: 5,
    endLatitude: 60.01,
    endLongitude: 5.02,
    durationMinutes: 20,
    assumedWaitMinutes: 15,
    boardingBufferMinutes: 5,
    source: "manual",
    sourceId: null,
    sourceUrl: null,
    operator: null,
    timetableUrl: null,
    bicycleAccess: "unknown",
    providerRefs: {},
    tags: {},
    createdAt: "2026-07-18T10:00:00.000Z",
    updatedAt: "2026-07-18T10:00:00.000Z",
    ...overrides,
  };
}

describe("ferryStore", () => {
  beforeEach(() => {
    useFerryStore.setState({ ferries: {}, loadingRouteIds: new Set(), revision: 0 });
    etaMocks.invalidateCache.mockClear();
  });

  it("loads persisted crossings once unless forced", async () => {
    const stored = ferry();
    databaseMocks.getFerryCrossingsForRoute.mockResolvedValue([stored]);

    await useFerryStore.getState().loadFerries("route-1");
    await useFerryStore.getState().loadFerries("route-1");

    expect(databaseMocks.getFerryCrossingsForRoute).toHaveBeenCalledOnce();
    expect(useFerryStore.getState().ferries["route-1"]).toEqual([stored]);
  });

  it("persists an ordered crossing and invalidates active ETA", async () => {
    const later = ferry({ id: "later", startDistanceMeters: 5_000, endDistanceMeters: 7_000 });
    useFerryStore.setState({ ferries: { "route-1": [later] } });
    const earlier = ferry();

    await useFerryStore.getState().saveFerry(earlier);

    expect(databaseMocks.upsertFerryCrossing).toHaveBeenCalledWith(earlier);
    expect(useFerryStore.getState().ferries["route-1"].map((item) => item.id)).toEqual([
      "ferry-1",
      "later",
    ]);
    expect(etaMocks.invalidateCache).toHaveBeenCalledOnce();
    expect(useFerryStore.getState().revision).toBe(1);
  });

  it("deletes the persisted crossing and removes it from route state", async () => {
    useFerryStore.setState({ ferries: { "route-1": [ferry()] } });

    await useFerryStore.getState().deleteFerry("route-1", "ferry-1");

    expect(databaseMocks.deleteFerryCrossing).toHaveBeenCalledWith("ferry-1");
    expect(useFerryStore.getState().ferries["route-1"]).toEqual([]);
    expect(useFerryStore.getState().revision).toBe(1);
  });
});
