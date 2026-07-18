import { describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({
  ActivityIndicator: () => null,
  AppState: { addEventListener: () => ({ remove: () => undefined }) },
  Platform: { OS: "ios" },
  View: () => null,
  useWindowDimensions: () => ({ height: 844, width: 390 }),
}));
vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ bottom: 0, left: 0, right: 0, top: 0 }),
}));
vi.mock("nativewind", () => ({
  useColorScheme: () => ({ colorScheme: "light" }),
}));
vi.mock("@/components/map/MapCanvas", () => ({ default: () => null }));
vi.mock("@/components/map/MapControls", () => ({ default: () => null }));
vi.mock("@/components/map/TabbedBottomPanel", () => ({ default: () => null }));
vi.mock("@/components/ui/text", () => ({ Text: () => null }));
vi.mock("@/hooks/useActiveRouteData", () => ({
  getActiveRouteDataImperative: () => null,
  useActiveRouteData: () => null,
}));
vi.mock("@/hooks/useActiveRouteTiming", () => ({ useActiveRouteTiming: () => ({}) }));
vi.mock("@/hooks/useMapStyle", () => ({ useMapStyle: () => ({}) }));
vi.mock("@/hooks/usePreparedRouteGeometries", () => ({
  isRouteGeometryRequestRenderable: () => false,
  preparedRouteGeometryHasError: () => false,
  preparedRouteGeometryMatchesRequest: () => false,
  usePreparedRouteGeometries: () => ({}),
}));
vi.mock("@/hooks/useRouteGeometryZoom", () => ({
  useRouteGeometryZoom: () => ({
    routeGeometryToleranceMeters: 0,
    updateRouteGeometryZoom: () => undefined,
  }),
}));
vi.mock("@/store/climbStore", () => ({ useClimbStore: () => null }));
vi.mock("@/store/collectionStore", () => ({ useCollectionStore: () => null }));
vi.mock("@/store/etaStore", () => ({ useEtaStore: () => null }));
vi.mock("@/store/ferryStore", () => ({ useFerryStore: () => null }));
vi.mock("@/store/mapStore", () => ({ useMapStore: () => null }));
vi.mock("@/store/offlineStore", () => ({ useOfflineStore: () => null }));
vi.mock("@/store/panelStore", () => ({ usePanelStore: () => null }));
vi.mock("@/store/poiStore", () => ({ usePoiStore: () => null }));
vi.mock("@/store/routeStore", () => ({ useRouteStore: () => null }));
vi.mock("@/store/settingsStore", () => ({ useSettingsStore: () => null }));
vi.mock("@/store/weatherStore", () => ({ useWeatherStore: () => null }));
vi.mock("@/theme", () => ({ useThemeColors: () => ({}) }));

import { buildEtaMarkerLabelMap } from "@/components/map/MapView";
import { buildRouteMarkerFeatureCollection } from "@/utils/routeMarkers";
import type { FerryCrossing, RoutePoint } from "@/types";

function point(idx: number, distanceFromStartMeters: number): RoutePoint {
  return {
    latitude: distanceFromStartMeters / 100_000,
    longitude: distanceFromStartMeters / 50_000,
    elevationMeters: null,
    distanceFromStartMeters,
    idx,
  };
}

function ferry(overrides: Partial<FerryCrossing> = {}): FerryCrossing {
  return {
    id: "ferry-1",
    routeId: "route-1",
    name: "Test ferry",
    startDistanceMeters: 9_000,
    endDistanceMeters: 21_000,
    startLatitude: 0,
    startLongitude: 0,
    endLatitude: 0,
    endLongitude: 0,
    durationMinutes: 0,
    assumedWaitMinutes: 0,
    boardingBufferMinutes: 0,
    source: "manual",
    sourceId: null,
    sourceUrl: null,
    operator: null,
    timetableUrl: null,
    bicycleAccess: "unknown",
    providerRefs: {},
    tags: {},
    createdAt: "2026-07-18T00:00:00.000Z",
    updatedAt: "2026-07-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("MapView ETA marker labels", () => {
  it("precomputes ferry-aware labels at the geometric positions of riding-distance markers", () => {
    const points = [point(0, 0), point(1, 40_000)];
    const ferrySpans = [{ startDistanceMeters: 9_000, endDistanceMeters: 21_000 }];
    const ferries = [ferry()];
    const etaBaseTimeMs = new Date(2026, 6, 8, 0, 0, 0).getTime();
    const labels = buildEtaMarkerLabelMap({
      cumulativeTime: [0, 1_680],
      points,
      fromDistanceMeters: 21_000,
      markerIntervalKm: 10,
      markerDistanceRange: { startDistanceMeters: 21_001, endDistanceMeters: 40_000 },
      ferries,
      plannedStops: [],
      etaBaseTimeMs,
    });

    expect([...labels.entries()]).toEqual([
      [22_000, "00:01"],
      [32_000, "00:11"],
    ]);

    const shape = buildRouteMarkerFeatureCollection({
      points,
      distanceMarkerMode: "eta",
      markerIntervalKm: 10,
      markerDistanceRange: { startDistanceMeters: 21_001, endDistanceMeters: 40_000 },
      excludedDistanceSpans: ferrySpans,
      etaLabelForDistanceMeters: (distanceMeters) => labels.get(distanceMeters) ?? null,
    });
    const distanceMarkers = shape.features.filter(
      (feature) => feature.properties.kind === "distance",
    );

    expect(distanceMarkers.map((feature) => feature.properties.distanceKm)).toEqual([10, 20]);
    expect(distanceMarkers.map((feature) => feature.properties.distanceMeters)).toEqual([
      22_000, 32_000,
    ]);
    expect(distanceMarkers.map((feature) => feature.properties.markerLabel)).toEqual([
      "00:01",
      "00:11",
    ]);
  });

  it("applies the full ferry delay at a landing boundary between raw route points", () => {
    const points = [point(0, 0), point(1, 20_000)];
    const ferries = [
      ferry({
        startDistanceMeters: 10_000,
        endDistanceMeters: 12_000,
        durationMinutes: 10,
      }),
    ];
    const etaBaseTimeMs = new Date(2026, 6, 8, 0, 0, 0).getTime();

    const labels = buildEtaMarkerLabelMap({
      // 18 km of road at 60 s/km plus a discrete 10-minute ferry delay.
      cumulativeTime: [0, 1_680],
      points,
      fromDistanceMeters: 0,
      markerIntervalKm: 10,
      markerDistanceRange: null,
      ferries,
      plannedStops: [],
      etaBaseTimeMs,
    });

    expect([...labels.entries()]).toEqual([[12_000, "00:20"]]);
  });
});
