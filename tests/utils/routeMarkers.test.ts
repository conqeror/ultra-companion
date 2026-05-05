import { describe, expect, it } from "vitest";
import {
  buildDistanceMarkerDistances,
  buildDistanceMarkerFeatures,
  buildRouteMarkerFeatureCollection,
  buildStartFinishMarkerFeatures,
  getDistanceMarkerIntervalForZoom,
} from "@/utils/routeMarkers";
import type { RoutePoint } from "@/types";

function point(idx: number, distanceFromStartMeters: number): RoutePoint {
  return {
    latitude: distanceFromStartMeters / 100_000,
    longitude: distanceFromStartMeters / 50_000,
    elevationMeters: null,
    distanceFromStartMeters,
    idx,
  };
}

describe("routeMarkers", () => {
  it("builds start and finish marker features from route endpoints", () => {
    const markers = buildStartFinishMarkerFeatures([point(0, 0), point(1, 5_000)]);

    expect(markers.map((feature) => feature.properties.kind)).toEqual(["start", "finish"]);
    expect(markers[0].geometry.coordinates).toEqual([0, 0]);
    expect(markers[1].properties.markerLabel).toBe("F");
  });

  it("labels overlapping loop endpoints clearly", () => {
    const markers = buildStartFinishMarkerFeatures([
      { ...point(0, 0), latitude: 48, longitude: 17 },
      { ...point(1, 20_000), latitude: 48.0001, longitude: 17.0001 },
    ]);

    expect(markers[1].properties.label).toBe("START / FINISH");
    expect(markers[1].properties.markerLabel).toBe("S/F");
  });

  it("creates interior distance markers without duplicating the finish", () => {
    expect(buildDistanceMarkerDistances(5_000, 1)).toEqual([1_000, 2_000, 3_000, 4_000]);
    expect(buildDistanceMarkerDistances(5_000, 5)).toEqual([]);
  });

  it("interpolates distance marker coordinates at kilometer marks", () => {
    const markers = buildDistanceMarkerFeatures([point(0, 0), point(1, 2_000)]);

    expect(markers).toHaveLength(1);
    expect(markers[0].properties.markerLabel).toBe("1");
    expect(markers[0].geometry.coordinates).toEqual([0.02, 0.01]);
  });

  it("keeps start and finish markers when distance markers are disabled", () => {
    const shape = buildRouteMarkerFeatureCollection({
      points: [point(0, 0), point(1, 3_000)],
      showDistanceMarkers: false,
    });

    expect(shape.features.map((feature) => feature.properties.kind)).toEqual(["start", "finish"]);
  });

  it("maps zoom levels to increasingly dense marker intervals", () => {
    expect(getDistanceMarkerIntervalForZoom(5)).toBe(100);
    expect(getDistanceMarkerIntervalForZoom(8)).toBe(25);
    expect(getDistanceMarkerIntervalForZoom(11)).toBe(5);
    expect(getDistanceMarkerIntervalForZoom(13)).toBe(1);
  });
});
