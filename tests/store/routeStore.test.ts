import { beforeEach, describe, expect, it, vi } from "vitest";
import { databaseMocks } from "@/tests/mocks/database";
import type { Route, RoutePoint } from "@/types";

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  File: class {
    text = vi.fn();
    delete = vi.fn();
  },
  Paths: { cache: "" },
}));

import { useRouteStore } from "@/store/routeStore";

const route = (overrides: Partial<Route> = {}): Route => ({
  id: "r1",
  name: "Route 1",
  fileName: "route.gpx",
  color: "#fff",
  isActive: true,
  isVisible: false,
  totalDistanceMeters: 1_000,
  totalAscentMeters: 100,
  totalDescentMeters: 50,
  pointCount: 2,
  createdAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

const point = (idx: number): RoutePoint => ({
  latitude: idx,
  longitude: 0,
  elevationMeters: 100,
  distanceFromStartMeters: idx * 100,
  idx,
});

describe("routeStore", () => {
  beforeEach(() => {
    useRouteStore.setState({
      routes: [],
      isLoading: false,
      error: null,
      visibleRoutePoints: {},
      snappedPosition: null,
      snapHistory: [],
    });
  });

  it("reloads active route points when visibility is turned back on", async () => {
    const hiddenActiveRoute = route();
    const visibleActiveRoute = route({ isVisible: true });
    const points = [point(0), point(1)];

    useRouteStore.setState({ routes: [hiddenActiveRoute], visibleRoutePoints: {} });
    databaseMocks.getAllRoutes.mockResolvedValue([visibleActiveRoute]);
    databaseMocks.getRoutePoints.mockResolvedValue(points);

    await useRouteStore.getState().toggleVisibility("r1");

    expect(databaseMocks.updateRouteVisibility).toHaveBeenCalledWith("r1", true);
    expect(databaseMocks.getRoutePoints).toHaveBeenCalledWith("r1");
    expect(useRouteStore.getState().routes).toEqual([visibleActiveRoute]);
    expect(useRouteStore.getState().visibleRoutePoints).toEqual({ r1: points });
  });

  it("clears snapped position and snap history together", () => {
    useRouteStore.setState({
      snappedPosition: {
        routeId: "r1",
        pointIndex: 0,
        distanceAlongRouteMeters: 100,
        distanceFromRouteMeters: 5,
      },
      snapHistory: [
        {
          routeId: "r1",
          latitude: 0,
          longitude: 0,
          timestamp: 1,
          heading: null,
          speed: null,
          selectedCandidate: {
            pointIndex: 0,
            segmentIndex: 0,
            projectedFraction: 0,
            distanceAlongRouteMeters: 100,
            distanceFromRouteMeters: 5,
            segmentBearingDegrees: 0,
          },
        },
      ],
    });

    useRouteStore.getState().clearRouteProgress();

    expect(useRouteStore.getState().snappedPosition).toBeNull();
    expect(useRouteStore.getState().snapHistory).toEqual([]);
  });
});
