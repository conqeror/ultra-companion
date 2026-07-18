import { haversineDistance, interpolateRoutePointAtDistance } from "./geo";
import {
  geometricDistanceAtRidingDistance,
  ridingDistanceAtGeometricDistance,
  totalRidingDistanceMeters,
  type FerryDistanceSpan,
} from "@/services/ferryCrossings";
import type { DistanceMarkerMode, RoutePoint } from "@/types";

export type RouteMarkerKind = "start" | "finish" | "distance";

export const DISTANCE_MARKER_INTERVALS = [100, 50, 25, 10, 5, 2, 1] as const;
export type DistanceMarkerInterval = (typeof DISTANCE_MARKER_INTERVALS)[number];

export interface DistanceMarkerBucket {
  intervalKm: DistanceMarkerInterval;
  minZoom: number;
  maxZoom?: number;
}

export const DISTANCE_MARKER_BUCKETS: readonly DistanceMarkerBucket[] = [
  { intervalKm: 100, minZoom: 0, maxZoom: 6.9 },
  { intervalKm: 50, minZoom: 6.9, maxZoom: 7.9 },
  { intervalKm: 25, minZoom: 7.9, maxZoom: 9 },
  { intervalKm: 10, minZoom: 9, maxZoom: 10.5 },
  { intervalKm: 5, minZoom: 10.5, maxZoom: 11.5 },
  { intervalKm: 2, minZoom: 11.5, maxZoom: 12.5 },
  { intervalKm: 1, minZoom: 12.5 },
];

export function getDistanceMarkerIntervalForZoom(zoom: number): DistanceMarkerInterval {
  for (const bucket of DISTANCE_MARKER_BUCKETS) {
    if (zoom >= bucket.minZoom && (bucket.maxZoom == null || zoom < bucket.maxZoom)) {
      return bucket.intervalKm;
    }
  }
  return DISTANCE_MARKER_BUCKETS[0].intervalKm;
}

export interface RouteMarkerProperties {
  kind: RouteMarkerKind;
  label: string;
  markerLabel: string;
  distanceKm?: number;
  isOverviewMarker?: boolean;
  distanceMeters: number;
  sortKey: number;
}

export type RouteMarkerFeature = GeoJSON.Feature<GeoJSON.Point, RouteMarkerProperties>;
export type RouteMarkerFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  RouteMarkerProperties
>;
export type DistanceMarkerLabelFormatter = (distanceMeters: number) => string | null;

export interface DistanceMarkerDistanceRange {
  startDistanceMeters: number;
  endDistanceMeters: number;
}

const NEAR_OVERLAP_THRESHOLD_M = 100;

function markerFeature(
  id: string,
  point: Pick<RoutePoint, "latitude" | "longitude" | "distanceFromStartMeters">,
  properties: Omit<RouteMarkerProperties, "distanceMeters">,
): RouteMarkerFeature {
  return {
    type: "Feature",
    id,
    geometry: {
      type: "Point",
      coordinates: [point.longitude, point.latitude],
    },
    properties: {
      ...properties,
      distanceMeters: point.distanceFromStartMeters,
    },
  };
}

function endpointsOverlap(start: RoutePoint, finish: RoutePoint): boolean {
  return (
    haversineDistance(start.latitude, start.longitude, finish.latitude, finish.longitude) <=
    NEAR_OVERLAP_THRESHOLD_M
  );
}

export function buildStartFinishMarkerFeatures(points: RoutePoint[]): RouteMarkerFeature[] {
  if (points.length < 2) return [];

  const start = points[0];
  const finish = points[points.length - 1];
  const overlapping = endpointsOverlap(start, finish);

  return [
    markerFeature("route-start", start, {
      kind: "start",
      label: "START",
      markerLabel: "S",
      sortKey: 0,
    }),
    markerFeature("route-finish", finish, {
      kind: "finish",
      label: overlapping ? "START / FINISH" : "FINISH",
      markerLabel: overlapping ? "S/F" : "F",
      sortKey: 1,
    }),
  ];
}

export function buildDistanceMarkerDistances(
  totalDistanceMeters: number,
  intervalKm: DistanceMarkerInterval = 1,
  range?: DistanceMarkerDistanceRange | null,
): number[] {
  const totalKm = totalDistanceMeters / 1000;
  if (totalKm < intervalKm) return [];

  const distances: number[] = [];
  const startMeters = Math.max(intervalKm * 1000, range?.startDistanceMeters ?? intervalKm * 1000);
  const endMeters = Math.min(totalDistanceMeters, range?.endDistanceMeters ?? totalDistanceMeters);
  const firstKm = Math.max(intervalKm, Math.ceil(startMeters / 1000 / intervalKm) * intervalKm);
  const lastKm = Math.min(totalKm, endMeters / 1000);

  for (let km = firstKm; km < lastKm; km += intervalKm) {
    distances.push(km * 1000);
  }
  return distances;
}

function strongestIntervalForDistance(km: number): DistanceMarkerInterval {
  for (const interval of DISTANCE_MARKER_INTERVALS) {
    if (km % interval === 0) return interval;
  }
  return 1;
}

function distanceMarkerLabel(distanceMeters: number): string {
  return String(distanceMeters / 1000);
}

export function buildDistanceMarkerFeatures(
  points: RoutePoint[],
  options: {
    intervalKm?: DistanceMarkerInterval;
    range?: DistanceMarkerDistanceRange | null;
    labelFormatter?: DistanceMarkerLabelFormatter;
    labelKind?: "distance" | "custom";
    excludedDistanceSpans?: readonly FerryDistanceSpan[];
  } = {},
): RouteMarkerFeature[] {
  if (points.length < 2) return [];

  const totalGeometricDistanceMeters = points[points.length - 1].distanceFromStartMeters;
  const excludedDistanceSpans = options.excludedDistanceSpans ?? [];
  const totalMarkerDistanceMeters = totalRidingDistanceMeters(
    totalGeometricDistanceMeters,
    excludedDistanceSpans,
  );
  const markerRange = options.range
    ? {
        startDistanceMeters: ridingDistanceAtGeometricDistance(
          options.range.startDistanceMeters,
          excludedDistanceSpans,
        ),
        endDistanceMeters: ridingDistanceAtGeometricDistance(
          options.range.endDistanceMeters,
          excludedDistanceSpans,
        ),
      }
    : null;
  const features: RouteMarkerFeature[] = [];
  const labelFormatter = options.labelFormatter ?? distanceMarkerLabel;
  const labelKind = options.labelKind ?? "distance";

  for (const markerDistanceMeters of buildDistanceMarkerDistances(
    totalMarkerDistanceMeters,
    options.intervalKm,
    markerRange,
  )) {
    const geometricDistanceMeters = geometricDistanceAtRidingDistance(
      markerDistanceMeters,
      totalGeometricDistanceMeters,
      excludedDistanceSpans,
    );
    const point = interpolateRoutePointAtDistance(points, geometricDistanceMeters);
    if (!point) continue;

    const km = markerDistanceMeters / 1000;
    const markerLabel = labelFormatter(
      labelKind === "custom" ? geometricDistanceMeters : markerDistanceMeters,
    );
    if (!markerLabel) continue;

    features.push(
      markerFeature(`route-distance-${km}`, point, {
        kind: "distance",
        label: labelKind === "distance" ? `${markerLabel} km` : markerLabel,
        markerLabel,
        distanceKm: km,
        sortKey: 10 + km,
      }),
    );
  }

  const hasOverviewMarker = features.some(
    (feature) => (feature.properties.distanceKm ?? 0) % 100 === 0,
  );

  if (!hasOverviewMarker && features.length > 0) {
    let bestIndex = 0;
    let bestInterval = strongestIntervalForDistance(features[0].properties.distanceKm ?? 1);

    for (let index = 1; index < features.length; index++) {
      const interval = strongestIntervalForDistance(features[index].properties.distanceKm ?? 1);
      if (interval > bestInterval) {
        bestIndex = index;
        bestInterval = interval;
      }
    }

    features[bestIndex] = {
      ...features[bestIndex],
      properties: {
        ...features[bestIndex].properties,
        isOverviewMarker: true,
      },
    };
  }

  return features;
}

export function buildRouteMarkerFeatureCollection(input: {
  points: RoutePoint[];
  distanceMarkerMode: DistanceMarkerMode;
  markerIntervalKm?: DistanceMarkerInterval;
  markerDistanceRange?: DistanceMarkerDistanceRange | null;
  etaLabelForDistanceMeters?: DistanceMarkerLabelFormatter;
  excludedDistanceSpans?: readonly {
    startDistanceMeters: number;
    endDistanceMeters: number;
  }[];
}): RouteMarkerFeatureCollection {
  const distanceMarkerFeatures =
    input.distanceMarkerMode === "off"
      ? []
      : buildDistanceMarkerFeatures(input.points, {
          intervalKm: input.markerIntervalKm,
          range: input.markerDistanceRange,
          labelFormatter:
            input.distanceMarkerMode === "eta"
              ? (input.etaLabelForDistanceMeters ?? (() => null))
              : undefined,
          labelKind: input.distanceMarkerMode === "eta" ? "custom" : "distance",
          excludedDistanceSpans: input.excludedDistanceSpans,
        });

  return {
    type: "FeatureCollection",
    features: [...buildStartFinishMarkerFeatures(input.points), ...distanceMarkerFeatures],
  };
}
