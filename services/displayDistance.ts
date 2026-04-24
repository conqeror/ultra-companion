import type { Climb, DisplayClimb, DisplayPOI, POI } from "@/types";

export function toDisplayPOI(poi: POI, distanceOffsetMeters = 0): DisplayPOI {
  return {
    ...poi,
    effectiveDistanceMeters: poi.distanceAlongRouteMeters + distanceOffsetMeters,
  };
}

export function toDisplayPOIs(pois: POI[], distanceOffsetMeters = 0): DisplayPOI[] {
  return pois.map((poi) => toDisplayPOI(poi, distanceOffsetMeters));
}

export function toDisplayClimb(climb: Climb, distanceOffsetMeters = 0): DisplayClimb {
  const effectiveStartDistanceMeters = climb.startDistanceMeters + distanceOffsetMeters;
  const effectiveEndDistanceMeters = climb.endDistanceMeters + distanceOffsetMeters;

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
