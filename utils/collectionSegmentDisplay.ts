import type { RoutePoint, StitchedSegmentInfo } from "@/types";

export type CollectionSegmentColorRole = "primary" | "alternate";

export interface CollectionSegmentProfileBoundary {
  distanceMeters: number;
  label: string;
  routeName: string;
  segmentIndex: number;
}

export interface CollectionSegmentBoundaryProperties {
  kind: "boundary";
  label: string;
  routeName: string;
  segmentIndex: number;
  distanceMeters: number;
  sortKey: number;
}

export interface CollectionSegmentLineProperties {
  routeId: string;
  routeName: string;
  segmentIndex: number;
  colorRole: CollectionSegmentColorRole;
  sortKey: number;
}

export interface CollectionSegmentMapFeatureCollections {
  lines: GeoJSON.FeatureCollection<GeoJSON.LineString, CollectionSegmentLineProperties>;
  boundaries: GeoJSON.FeatureCollection<GeoJSON.Point, CollectionSegmentBoundaryProperties>;
}

export type PreparedCollectionSegmentLine =
  | GeoJSON.Feature<GeoJSON.LineString>
  | readonly GeoJSON.Feature<GeoJSON.LineString>[]
  | null
  | undefined;

export function buildCollectionSegmentProfileBoundaries(
  segments: readonly StitchedSegmentInfo[] | null | undefined,
): CollectionSegmentProfileBoundary[] {
  if (!segments || segments.length <= 1) return [];

  return segments.slice(1).map((segment, index) => {
    const segmentIndex = index + 1;
    return {
      distanceMeters: segment.distanceOffsetMeters,
      label: segmentLabel(segmentIndex),
      routeName: segment.routeName,
      segmentIndex,
    };
  });
}

export function filterCollectionSegmentProfileBoundariesForRange(
  boundaries: readonly CollectionSegmentProfileBoundary[] | null | undefined,
  startDistanceMeters: number,
  endDistanceMeters: number,
): CollectionSegmentProfileBoundary[] {
  if (!boundaries || boundaries.length === 0 || endDistanceMeters <= startDistanceMeters) return [];

  return boundaries.filter(
    (boundary) =>
      boundary.distanceMeters > startDistanceMeters && boundary.distanceMeters < endDistanceMeters,
  );
}

export function buildCollectionSegmentMapFeatureCollections(
  points: readonly RoutePoint[] | null | undefined,
  segments: readonly StitchedSegmentInfo[] | null | undefined,
): CollectionSegmentMapFeatureCollections {
  const empty = emptyCollectionSegmentMapFeatureCollections();
  if (!points || points.length < 2 || !segments || segments.length <= 1) return empty;

  const lines: GeoJSON.Feature<GeoJSON.LineString, CollectionSegmentLineProperties>[] = [];
  const boundaries: GeoJSON.Feature<GeoJSON.Point, CollectionSegmentBoundaryProperties>[] = [];

  segments.forEach((segment, index) => {
    const segmentPoints = points.slice(segment.startPointIndex, segment.endPointIndex + 1);
    if (segmentPoints.length >= 2) {
      lines.push({
        type: "Feature",
        properties: {
          routeId: segment.routeId,
          routeName: segment.routeName,
          segmentIndex: index,
          colorRole: segmentColorRole(index),
          sortKey: index,
        },
        geometry: {
          type: "LineString",
          coordinates: segmentPoints.map((point) => [point.longitude, point.latitude]),
        },
      });
    }

    if (index === 0) return;
    const boundaryPoint = points[segment.startPointIndex];
    if (!boundaryPoint) return;

    boundaries.push({
      type: "Feature",
      properties: {
        kind: "boundary",
        label: segmentLabel(index),
        routeName: segment.routeName,
        segmentIndex: index,
        distanceMeters: segment.distanceOffsetMeters,
        sortKey: 100 + index,
      },
      geometry: {
        type: "Point",
        coordinates: [boundaryPoint.longitude, boundaryPoint.latitude],
      },
    });
  });

  return {
    lines: { type: "FeatureCollection", features: lines },
    boundaries: { type: "FeatureCollection", features: boundaries },
  };
}

/**
 * Builds the colored collection source from already simplified line geometry.
 * The coordinate arrays are reused directly, so rendering does not remap the
 * full stitched route after geometry preparation has completed.
 */
export function buildCollectionSegmentMapFeatureCollectionsFromPreparedLines(
  points: readonly RoutePoint[] | null | undefined,
  segments: readonly StitchedSegmentInfo[] | null | undefined,
  preparedLines: readonly PreparedCollectionSegmentLine[],
): CollectionSegmentMapFeatureCollections {
  const empty = emptyCollectionSegmentMapFeatureCollections();
  if (!points || points.length < 2 || !segments || segments.length <= 1) return empty;

  const lines: GeoJSON.Feature<GeoJSON.LineString, CollectionSegmentLineProperties>[] = [];
  const boundaries: GeoJSON.Feature<GeoJSON.Point, CollectionSegmentBoundaryProperties>[] = [];

  segments.forEach((segment, index) => {
    const preparedLine = preparedLines[index];
    const preparedPieces = Array.isArray(preparedLine)
      ? preparedLine
      : preparedLine
        ? [preparedLine]
        : [];
    preparedPieces.forEach((piece, pieceIndex) => {
      if (piece.geometry.coordinates.length < 2) return;
      lines.push({
        type: "Feature",
        properties: {
          routeId: segment.routeId,
          routeName: segment.routeName,
          segmentIndex: index,
          colorRole: segmentColorRole(index),
          sortKey: index + pieceIndex / Math.max(1, preparedPieces.length),
        },
        geometry: piece.geometry,
      });
    });

    if (index === 0) return;
    const boundaryPoint = points[segment.startPointIndex];
    if (!boundaryPoint) return;
    boundaries.push({
      type: "Feature",
      properties: {
        kind: "boundary",
        label: segmentLabel(index),
        routeName: segment.routeName,
        segmentIndex: index,
        distanceMeters: segment.distanceOffsetMeters,
        sortKey: 100 + index,
      },
      geometry: {
        type: "Point",
        coordinates: [boundaryPoint.longitude, boundaryPoint.latitude],
      },
    });
  });

  return {
    lines: { type: "FeatureCollection", features: lines },
    boundaries: { type: "FeatureCollection", features: boundaries },
  };
}

function emptyCollectionSegmentMapFeatureCollections(): CollectionSegmentMapFeatureCollections {
  return {
    lines: { type: "FeatureCollection", features: [] },
    boundaries: { type: "FeatureCollection", features: [] },
  };
}

function segmentLabel(segmentIndex: number): string {
  return `S${segmentIndex + 1}`;
}

function segmentColorRole(segmentIndex: number): CollectionSegmentColorRole {
  return segmentIndex % 2 === 0 ? "primary" : "alternate";
}
