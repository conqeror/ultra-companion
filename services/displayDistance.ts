import type {
  Climb,
  DisplayClimb,
  DisplayDistanceMeters,
  DisplayPOI,
  POI,
  StitchedSegmentInfo,
} from "@/types";

export function toDisplayDistanceMeters(distanceMeters: number): DisplayDistanceMeters {
  return distanceMeters as DisplayDistanceMeters;
}

export function toDisplayPOI(poi: POI, distanceOffsetMeters = 0): DisplayPOI {
  return {
    ...poi,
    effectiveDistanceMeters: toDisplayDistanceMeters(
      poi.distanceAlongRouteMeters + distanceOffsetMeters,
    ),
  };
}

export function toDisplayPOIs(pois: POI[], distanceOffsetMeters = 0): DisplayPOI[] {
  return pois.map((poi) => toDisplayPOI(poi, distanceOffsetMeters));
}

export function toDisplayPOIForSegments(
  poi: POI,
  segments: StitchedSegmentInfo[] | null,
): DisplayPOI | null {
  if (!segments) return toDisplayPOI(poi);

  const segment = segments.find((s) => s.routeId === poi.routeId);
  return segment ? toDisplayPOI(poi, segment.distanceOffsetMeters) : null;
}

export function toDisplayClimb(climb: Climb, distanceOffsetMeters = 0): DisplayClimb {
  const effectiveStartDistanceMeters = toDisplayDistanceMeters(
    climb.startDistanceMeters + distanceOffsetMeters,
  );
  const effectiveEndDistanceMeters = toDisplayDistanceMeters(
    climb.endDistanceMeters + distanceOffsetMeters,
  );

  return {
    ...climb,
    effectiveDistanceMeters: effectiveStartDistanceMeters,
    effectiveStartDistanceMeters,
    effectiveEndDistanceMeters,
  };
}

export function toDisplayClimbs(climbs: Climb[], distanceOffsetMeters = 0): DisplayClimb[] {
  return climbs.map((climb) => toDisplayClimb(climb, distanceOffsetMeters));
}
