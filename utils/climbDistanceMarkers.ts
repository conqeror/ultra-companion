import { interpolateRoutePointAtDistance } from "@/utils/geo";
import type { RoutePoint } from "@/types";

export type ClimbDistanceMarkerKind = "start" | "distance" | "top";

export interface ClimbDistanceMarkerProperties {
  kind: ClimbDistanceMarkerKind;
  label: string;
  markerLabel: string;
  localDistanceMeters: number;
  distanceAlongRouteMeters: number;
  sortKey: number;
}

export type ClimbDistanceMarkerFeature = GeoJSON.Feature<
  GeoJSON.Point,
  ClimbDistanceMarkerProperties
>;
export type ClimbDistanceMarkerFeatureCollection = GeoJSON.FeatureCollection<
  GeoJSON.Point,
  ClimbDistanceMarkerProperties
>;

const SHORT_CLIMB_INTERVAL_M = 1000;
const LONG_CLIMB_INTERVAL_M = 2000;
const EXTRA_LONG_CLIMB_INTERVAL_M = 5000;
const LONG_CLIMB_THRESHOLD_M = 15_000;
const EXTRA_LONG_CLIMB_THRESHOLD_M = 40_000;

export function climbMarkerIntervalMeters(lengthMeters: number): number {
  if (lengthMeters >= EXTRA_LONG_CLIMB_THRESHOLD_M) return EXTRA_LONG_CLIMB_INTERVAL_M;
  if (lengthMeters >= LONG_CLIMB_THRESHOLD_M) return LONG_CLIMB_INTERVAL_M;
  return SHORT_CLIMB_INTERVAL_M;
}

export function buildClimbMarkerDistances(lengthMeters: number): number[] {
  if (!Number.isFinite(lengthMeters) || lengthMeters <= 0) return [];

  const intervalMeters = climbMarkerIntervalMeters(lengthMeters);
  const distances = [0];
  for (
    let distanceMeters = intervalMeters;
    distanceMeters < lengthMeters;
    distanceMeters += intervalMeters
  ) {
    distances.push(distanceMeters);
  }
  distances.push(lengthMeters);
  return distances;
}

export function buildClimbDistanceMarkerFeatureCollection(input: {
  points: RoutePoint[];
  startDistanceMeters: number;
  endDistanceMeters: number;
}): ClimbDistanceMarkerFeatureCollection {
  const { points, startDistanceMeters, endDistanceMeters } = input;
  const lengthMeters = endDistanceMeters - startDistanceMeters;
  if (points.length < 2 || lengthMeters <= 0) {
    return { type: "FeatureCollection", features: [] };
  }

  const features: ClimbDistanceMarkerFeature[] = [];
  const localDistances = buildClimbMarkerDistances(lengthMeters);
  for (let index = 0; index < localDistances.length; index++) {
    const localDistanceMeters = localDistances[index];
    const absoluteDistanceMeters = startDistanceMeters + localDistanceMeters;
    const point = interpolateRoutePointAtDistance(points, absoluteDistanceMeters);
    if (!point) continue;

    const kind =
      localDistanceMeters === 0
        ? "start"
        : localDistanceMeters >= lengthMeters
          ? "top"
          : "distance";
    const km = localDistanceMeters / 1000;
    const markerLabel = kind === "top" ? "TOP" : String(Math.round(km));
    const label = kind === "top" ? "Top" : `${markerLabel} km`;

    features.push({
      type: "Feature",
      id: `climb-marker-${kind}-${Math.round(localDistanceMeters)}`,
      geometry: {
        type: "Point",
        coordinates: [point.longitude, point.latitude],
      },
      properties: {
        kind,
        label,
        markerLabel,
        localDistanceMeters,
        distanceAlongRouteMeters: point.distanceFromStartMeters,
        sortKey: index,
      },
    });
  }

  return { type: "FeatureCollection", features };
}
