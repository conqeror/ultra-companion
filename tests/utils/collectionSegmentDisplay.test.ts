import { describe, expect, it } from "vitest";
import {
  buildCollectionSegmentMapFeatureCollections,
  buildCollectionSegmentMapFeatureCollectionsFromPreparedLines,
  buildCollectionSegmentProfileBoundaries,
  filterCollectionSegmentProfileBoundariesForRange,
} from "@/utils/collectionSegmentDisplay";
import type { RoutePoint, StitchedSegmentInfo } from "@/types";

function point(idx: number, distanceFromStartMeters: number): RoutePoint {
  return {
    latitude: 48 + idx / 100,
    longitude: 17 + idx / 100,
    elevationMeters: null,
    distanceFromStartMeters,
    idx,
  };
}

function segment(index: number, overrides: Partial<StitchedSegmentInfo> = {}): StitchedSegmentInfo {
  const startPointIndex = index * 2;
  const endPointIndex = startPointIndex + 1;
  return {
    routeId: `r${index + 1}`,
    routeName: `Segment ${index + 1}`,
    position: index,
    variantKind: "full",
    baseRouteId: null,
    replaceStartDistanceMeters: null,
    replaceEndDistanceMeters: null,
    startPointIndex,
    endPointIndex,
    distanceOffsetMeters: index * 1_000,
    segmentDistanceMeters: 1_000,
    segmentAscentMeters: 100,
    segmentDescentMeters: 0,
    sourceSpans: [],
    ...overrides,
  };
}

describe("collectionSegmentDisplay", () => {
  it("returns no display features for missing or single-segment collections", () => {
    const points = [point(0, 0), point(1, 1_000)];

    expect(buildCollectionSegmentProfileBoundaries(null)).toEqual([]);
    expect(buildCollectionSegmentProfileBoundaries([segment(0)])).toEqual([]);
    expect(buildCollectionSegmentMapFeatureCollections(points, [segment(0)])).toEqual({
      lines: { type: "FeatureCollection", features: [] },
      boundaries: { type: "FeatureCollection", features: [] },
    });
  });

  it("builds one profile boundary per interior segment transition", () => {
    const boundaries = buildCollectionSegmentProfileBoundaries([
      segment(0),
      segment(1),
      segment(2),
    ]);

    expect(boundaries).toEqual([
      {
        distanceMeters: 1_000,
        label: "S2",
        routeName: "Segment 2",
        segmentIndex: 1,
      },
      {
        distanceMeters: 2_000,
        label: "S3",
        routeName: "Segment 3",
        segmentIndex: 2,
      },
    ]);
  });

  it("uses the next segment start point for duplicate-distance joins", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 1_000), point(3, 2_000)];
    const features = buildCollectionSegmentMapFeatureCollections(points, [segment(0), segment(1)]);

    expect(features.boundaries.features).toHaveLength(1);
    expect(features.boundaries.features[0]).toMatchObject({
      properties: {
        label: "S2",
        routeName: "Segment 2",
        segmentIndex: 1,
        distanceMeters: 1_000,
      },
      geometry: {
        type: "Point",
        coordinates: [17.02, 48.02],
      },
    });
  });

  it("builds colored route lines for valid segments and skips too-short geometry", () => {
    const points = [
      point(0, 0),
      point(1, 1_000),
      point(2, 1_000),
      point(3, 2_000),
      point(4, 2_000),
    ];
    const features = buildCollectionSegmentMapFeatureCollections(points, [
      segment(0),
      segment(1),
      segment(2, { startPointIndex: 4, endPointIndex: 4 }),
    ]);

    expect(features.lines.features).toHaveLength(2);
    expect(features.lines.features.map((feature) => feature.properties.colorRole)).toEqual([
      "primary",
      "alternate",
    ]);
    expect(features.lines.features[1].geometry.coordinates).toEqual([
      [17.02, 48.02],
      [17.03, 48.03],
    ]);
    expect(features.boundaries.features.map((feature) => feature.properties.label)).toEqual([
      "S2",
      "S3",
    ]);
  });

  it("reuses prepared segment geometry without rebuilding raw stitched coordinates", () => {
    const points = [point(0, 0), point(1, 1_000), point(2, 1_000), point(3, 2_000)];
    const firstGeometry: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [17, 48],
        [17.01, 48.01],
      ],
    };
    const secondGeometry: GeoJSON.LineString = {
      type: "LineString",
      coordinates: [
        [17.02, 48.02],
        [17.03, 48.03],
      ],
    };

    const features = buildCollectionSegmentMapFeatureCollectionsFromPreparedLines(
      points,
      [segment(0), segment(1)],
      [
        { type: "Feature", properties: {}, geometry: firstGeometry },
        { type: "Feature", properties: {}, geometry: secondGeometry },
      ],
    );

    expect(features.lines.features.map((feature) => feature.properties.colorRole)).toEqual([
      "primary",
      "alternate",
    ]);
    expect(features.lines.features[0].geometry).toBe(firstGeometry);
    expect(features.lines.features[1].geometry).toBe(secondGeometry);
    expect(features.boundaries.features[0].properties.label).toBe("S2");
  });

  it("filters profile boundaries to the visible absolute-distance range", () => {
    const boundaries = buildCollectionSegmentProfileBoundaries([
      segment(0),
      segment(1),
      segment(2),
      segment(3),
    ]);

    expect(filterCollectionSegmentProfileBoundariesForRange(boundaries, 1_000, 3_000)).toEqual([
      {
        distanceMeters: 2_000,
        label: "S3",
        routeName: "Segment 3",
        segmentIndex: 2,
      },
    ]);
  });
});
