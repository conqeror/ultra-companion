import { beforeEach, describe, expect, it, vi } from "vitest";
import * as DocumentPicker from "expo-document-picker";
import { databaseMocks } from "@/tests/mocks/database";
import type { Route, RoutePoint } from "@/types";

const { fileText, detectClimbsForRoute } = vi.hoisted(() => ({
  fileText: vi.fn(),
  detectClimbsForRoute: vi.fn(),
}));

vi.mock("expo-document-picker", () => ({
  getDocumentAsync: vi.fn(),
}));

vi.mock("expo-file-system", () => ({
  File: class {
    text = fileText;
    delete = vi.fn();
  },
  Paths: { cache: "" },
}));

vi.mock("@/services/climbDetector", () => ({
  detectClimbsForRoute,
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

const validGpx = `<?xml version="1.0"?>
<gpx><trk><name>Atomic route</name><trkseg>
  <trkpt lat="48.1" lon="17.1"><ele>120</ele></trkpt>
  <trkpt lat="48.2" lon="17.2"><ele>130</ele></trkpt>
</trkseg></trk></gpx>`;

describe("routeStore", () => {
  beforeEach(() => {
    vi.mocked(DocumentPicker.getDocumentAsync).mockReset();
    fileText.mockReset();
    detectClimbsForRoute.mockReset();
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

  it("commits the route, points, and detected climbs together", async () => {
    const climbs = [
      {
        id: "climb-1",
        routeId: "ignored",
        name: null,
        startDistanceMeters: 0,
        endDistanceMeters: 1_000,
        lengthMeters: 1_000,
        totalAscentMeters: 100,
        startElevationMeters: 100,
        endElevationMeters: 200,
        averageGradientPercent: 10,
        maxGradientPercent: 12,
        difficultyScore: 100,
      },
    ];
    fileText.mockResolvedValue(validGpx);
    detectClimbsForRoute.mockResolvedValue(climbs);

    const imported = await useRouteStore.getState().importFromUri("file://route.gpx", "route.gpx");

    expect(detectClimbsForRoute).toHaveBeenCalledWith(imported.id, expect.any(Array));
    expect(databaseMocks.insertRoute).toHaveBeenCalledWith(imported, expect.any(Array), climbs);
  });

  it("does not persist a route when climb detection fails", async () => {
    fileText.mockResolvedValue(validGpx);
    detectClimbsForRoute.mockRejectedValue(new Error("Climb detection failed"));

    await expect(
      useRouteStore.getState().importFromUri("file://route.gpx", "route.gpx"),
    ).rejects.toThrow("Climb detection failed");

    expect(databaseMocks.insertRoute).not.toHaveBeenCalled();
  });

  it("reports a transactional persistence failure without treating the route as imported", async () => {
    fileText.mockResolvedValue(validGpx);
    detectClimbsForRoute.mockResolvedValue([]);
    databaseMocks.insertRoute.mockRejectedValue(new Error("Route transaction failed"));

    await expect(
      useRouteStore.getState().importFromUri("file://route.gpx", "route.gpx"),
    ).rejects.toThrow("Route transaction failed");

    expect(databaseMocks.getAllRoutes).not.toHaveBeenCalled();
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

  it("keeps importing remaining files when unnamed asset URI decoding fails", async () => {
    const importedA = route({ id: "r1", name: "Segment 1", fileName: "segment-1.gpx" });
    const importedB = route({ id: "r2", name: "Segment 2", fileName: "segment-2.kml" });
    const importFromUri = vi.fn().mockResolvedValueOnce(importedA).mockResolvedValueOnce(importedB);

    vi.mocked(DocumentPicker.getDocumentAsync).mockResolvedValue({
      canceled: false,
      assets: [
        { uri: "file://segment-1.gpx", name: "segment-1.gpx", lastModified: 0 },
        { uri: "file://bad%ZZ.gpx", name: "", lastModified: 0 },
        { uri: "file://segment-2.kml", name: "segment-2.kml", lastModified: 0 },
      ],
    });
    useRouteStore.setState({ importFromUri });

    const summary = await useRouteStore.getState().importRoute();

    expect(importFromUri).toHaveBeenCalledTimes(2);
    expect(importFromUri).toHaveBeenNthCalledWith(
      1,
      "file://segment-1.gpx",
      "segment-1.gpx",
      expect.objectContaining({ createdAt: expect.any(String) }),
    );
    expect(importFromUri).toHaveBeenNthCalledWith(
      2,
      "file://segment-2.kml",
      "segment-2.kml",
      expect.objectContaining({ createdAt: expect.any(String) }),
    );
    expect(summary).toEqual({
      imported: [importedA, importedB],
      failed: [
        {
          fileName: "route-2",
          reason: "URI malformed",
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
