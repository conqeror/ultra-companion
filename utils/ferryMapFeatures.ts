import type { DisplayFerryCrossing } from "@/types";
import { resolveFerryMapGeometry, type FerryGeometryPoint } from "@/services/ferryGeometry";
import { haversineDistance } from "@/utils/geo";

export interface FerryMapLineProperties {
  crossingId: string;
  occurrenceKey: string;
  name: string;
  sortKey: number;
}

export interface FerryMapEndpointProperties extends FerryMapLineProperties {
  role: "boarding" | "landing";
  label: "B" | "L";
  roleLabel: "Board" | "Land";
}

export interface FerryMapLabelProperties extends FerryMapLineProperties {
  label: string;
}

export interface FerryMapFeatureCollections {
  lines: GeoJSON.FeatureCollection<GeoJSON.LineString, FerryMapLineProperties>;
  endpoints: GeoJSON.FeatureCollection<GeoJSON.Point, FerryMapEndpointProperties>;
  labels: GeoJSON.FeatureCollection<GeoJSON.Point, FerryMapLabelProperties>;
}

function interpolatedLongitude(start: number, end: number, fraction: number): number {
  let adjustedEnd = end;
  const delta = end - start;
  if (delta > 180) adjustedEnd -= 360;
  if (delta < -180) adjustedEnd += 360;
  const interpolated = start + (adjustedEnd - start) * fraction;
  if (interpolated > 180) return interpolated - 360;
  if (interpolated < -180) return interpolated + 360;
  return interpolated;
}

function polylineMidpoint(points: readonly FerryGeometryPoint[]): FerryGeometryPoint {
  if (points.length < 2) return points[0];
  const segmentLengths: number[] = [];
  let totalMeters = 0;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const point = points[index];
    const length = haversineDistance(
      previous.latitude,
      previous.longitude,
      point.latitude,
      point.longitude,
    );
    segmentLengths.push(length);
    totalMeters += length;
  }
  if (totalMeters <= 0) return points[0];
  const target = totalMeters / 2;
  let traversed = 0;
  for (let index = 0; index < segmentLengths.length; index++) {
    const segmentLength = segmentLengths[index];
    if (traversed + segmentLength < target) {
      traversed += segmentLength;
      continue;
    }
    const start = points[index];
    const end = points[index + 1];
    const fraction = segmentLength > 0 ? (target - traversed) / segmentLength : 0;
    return {
      latitude: start.latitude + (end.latitude - start.latitude) * fraction,
      longitude: interpolatedLongitude(start.longitude, end.longitude, fraction),
    };
  }
  return points[points.length - 1];
}

export function emptyFerryMapFeatureCollections(): FerryMapFeatureCollections {
  return {
    lines: { type: "FeatureCollection", features: [] },
    endpoints: { type: "FeatureCollection", features: [] },
    labels: { type: "FeatureCollection", features: [] },
  };
}

export function buildFerryMapFeatureCollections(
  crossings: readonly DisplayFerryCrossing[] | null | undefined,
): FerryMapFeatureCollections {
  const features = emptyFerryMapFeatureCollections();
  if (!crossings?.length) return features;

  crossings.forEach((crossing, index) => {
    const geometry = resolveFerryMapGeometry(crossing);
    if (!geometry || geometry.length < 2) return;

    const name = crossing.name.trim() || "Ferry crossing";
    const occurrenceKey = `${crossing.id}:${crossing.effectiveStartDistanceMeters.toFixed(1)}:${index}`;
    const common: FerryMapLineProperties = {
      crossingId: crossing.id,
      occurrenceKey,
      name,
      sortKey: index,
    };
    const start: GeoJSON.Position = [crossing.startLongitude, crossing.startLatitude];
    const end: GeoJSON.Position = [crossing.endLongitude, crossing.endLatitude];
    const midpoint = polylineMidpoint(geometry);

    features.lines.features.push({
      type: "Feature",
      properties: common,
      geometry: {
        type: "LineString",
        coordinates: geometry.map((point) => [point.longitude, point.latitude]),
      },
    });
    features.endpoints.features.push(
      {
        type: "Feature",
        properties: {
          ...common,
          role: "boarding",
          label: "B",
          roleLabel: "Board",
          sortKey: index * 2,
        },
        geometry: { type: "Point", coordinates: start },
      },
      {
        type: "Feature",
        properties: {
          ...common,
          role: "landing",
          label: "L",
          roleLabel: "Land",
          sortKey: index * 2 + 1,
        },
        geometry: { type: "Point", coordinates: end },
      },
    );
    features.labels.features.push({
      type: "Feature",
      properties: { ...common, label: name },
      geometry: {
        type: "Point",
        coordinates: [midpoint.longitude, midpoint.latitude],
      },
    });
  });

  return features;
}
