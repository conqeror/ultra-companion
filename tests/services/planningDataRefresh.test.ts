import { describe, expect, it, vi } from "vitest";
import { databaseMocks } from "@/tests/mocks/database";
import { refreshPlanningData } from "@/services/planningDataRefresh";
import type { Route } from "@/types";

const route = (id: string, isActive = false): Route => ({
  id,
  name: id,
  fileName: `${id}.gpx`,
  color: "#fff",
  isActive,
  isVisible: true,
  totalDistanceMeters: 1_000,
  totalAscentMeters: 100,
  totalDescentMeters: 50,
  pointCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("refreshPlanningData", () => {
  it("loads metadata and only the active standalone route's points", async () => {
    let routes: Route[] = [];
    const loadRouteMetadata = vi.fn(async () => {
      routes = [route("active", true), route("visible-a"), route("visible-b")];
    });
    const loadRoutePoints = vi.fn(async (routeIds: string[]) => {
      await Promise.all(routeIds.map((routeId) => databaseMocks.getRoutePoints(routeId)));
    });

    await refreshPlanningData({
      clearRouteViewState: vi.fn(),
      clearPoiViewState: vi.fn(),
      clearClimbCache: vi.fn(),
      clearFerryCache: vi.fn(),
      loadRouteMetadata,
      activeStandaloneRouteId: () => routes.find((item) => item.isActive)?.id ?? null,
      loadRoutePoints,
      loadCollections: vi.fn().mockResolvedValue(undefined),
      loadStarredItems: vi.fn().mockResolvedValue(undefined),
    });

    expect(loadRouteMetadata).toHaveBeenCalledTimes(1);
    expect(loadRoutePoints).toHaveBeenCalledWith(["active"], { prune: true });
    expect(databaseMocks.getRoutePoints).toHaveBeenCalledTimes(1);
    expect(databaseMocks.getRoutePoints).toHaveBeenCalledWith("active");
  });

  it("does not populate visible route points when collection activation owns the geometry", async () => {
    const loadRoutePoints = vi.fn().mockResolvedValue(undefined);

    await refreshPlanningData({
      clearRouteViewState: vi.fn(),
      clearPoiViewState: vi.fn(),
      clearClimbCache: vi.fn(),
      clearFerryCache: vi.fn(),
      loadRouteMetadata: vi.fn().mockResolvedValue(undefined),
      activeStandaloneRouteId: () => null,
      loadRoutePoints,
      loadCollections: vi.fn().mockResolvedValue(undefined),
      loadStarredItems: vi.fn().mockResolvedValue(undefined),
    });

    expect(loadRoutePoints).toHaveBeenCalledWith([], { prune: true });
    expect(databaseMocks.getRoutePoints).not.toHaveBeenCalled();
  });
});
