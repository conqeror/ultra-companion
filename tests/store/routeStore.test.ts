import { beforeEach, describe, expect, it, vi } from "vitest";
import * as DocumentPicker from "expo-document-picker";
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

const initialImportRoute = useRouteStore.getState().importRoute;
const initialImportFromUri = useRouteStore.getState().importFromUri;

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
    vi.mocked(DocumentPicker.getDocumentAsync).mockReset();
    useRouteStore.setState({
      routes: [],
      isLoading: false,
      error: null,
      importProgress: null,
      visibleRoutePoints: {},
      snappedPosition: null,
      snapHistory: [],
      importRoute: initialImportRoute,
      importFromUri: initialImportFromUri,
    });
  });

  it("imports every selected route file and isolates per-file failures", async () => {
    const importedA = route({ id: "r1", name: "Segment 1", fileName: "segment-1.gpx" });
    const importedB = route({ id: "r2", name: "Segment 2", fileName: "segment-2.kml" });
    const importFromUri = vi
      .fn()
      .mockResolvedValueOnce(importedA)
      .mockRejectedValueOnce(new Error("Invalid GPX: missing <gpx> root element"))
      .mockResolvedValueOnce(importedB);

    vi.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file://segment-1.gpx", name: "segment-1.gpx", lastModified: 0 },
        { uri: "file://bad.gpx", name: "bad.gpx", lastModified: 0 },
        { uri: "file://segment-2.kml", name: "segment-2.kml", lastModified: 0 },
      ],
    });
    useRouteStore.setState({ importFromUri });

    const summary = await useRouteStore.getState().importRoute();

    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith(
      expect.objectContaining({ multiple: true }),
    );
    expect(importFromUri).toHaveBeenNthCalledWith(
      1,
      "file://segment-1.gpx",
      "segment-1.gpx",
      expect.objectContaining({ createdAt: expect.any(String) }),
    );
    expect(importFromUri).toHaveBeenNthCalledWith(
      2,
      "file://bad.gpx",
      "bad.gpx",
      expect.objectContaining({ createdAt: expect.any(String) }),
    );
    expect(importFromUri).toHaveBeenNthCalledWith(
      3,
      "file://segment-2.kml",
      "segment-2.kml",
      expect.objectContaining({ createdAt: expect.any(String) }),
    );
    expect(summary).toEqual({
      imported: [importedA, importedB],
      failed: [
        {
          fileName: "bad.gpx",
          reason: "Invalid GPX: missing <gpx> root element",
        },
      ],
      total: 3,
    });
    expect(useRouteStore.getState().isLoading).toBe(false);
    expect(useRouteStore.getState().importProgress).toBeNull();
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
