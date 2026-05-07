import type {
  Climb,
  DisplayClimb,
  DisplayDistanceMeters,
  DisplayPOI,
  POI,
  StitchedSegmentInfo,
  StitchedSourceSpan,
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

  const span = findSourceSpanForDistance(
    segments.flatMap((segment) => segment.sourceSpans),
    poi.routeId,
    poi.distanceAlongRouteMeters,
  );
  return span ? toDisplayPOI(poi, span.distanceOffsetMeters) : null;
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

export function findSourceSpanForDistance(
  spans: StitchedSourceSpan[],
  routeId: string,
  distanceMeters: number,
): StitchedSourceSpan | null {
  return (
    spans.find(
      (span) =>
        span.routeId === routeId &&
        distanceMeters >= span.rawStartDistanceMeters &&
        distanceMeters <= span.rawEndDistanceMeters,
    ) ?? null
  );
}

export function toDisplayClimbForSpan(climb: Climb, span: StitchedSourceSpan): DisplayClimb | null {
  const clippedStart = Math.max(climb.startDistanceMeters, span.rawStartDistanceMeters);
  const clippedEnd = Math.min(climb.endDistanceMeters, span.rawEndDistanceMeters);
  if (clippedEnd <= clippedStart) return null;

  const originalLength = Math.max(1, climb.endDistanceMeters - climb.startDistanceMeters);
  const clippedLength = clippedEnd - clippedStart;
  const lengthRatio = Math.min(1, clippedLength / originalLength);
  const clippedAscent = climb.totalAscentMeters * lengthRatio;
  const clippedAverageGradient = (clippedAscent / clippedLength) * 100;
  const clippedDifficultyScore = climb.difficultyScore * lengthRatio;

  const effectiveStartDistanceMeters = toDisplayDistanceMeters(
    clippedStart + span.distanceOffsetMeters,
  );
  const effectiveEndDistanceMeters = toDisplayDistanceMeters(
    clippedEnd + span.distanceOffsetMeters,
  );

  return {
    ...climb,
    startDistanceMeters: clippedStart,
    endDistanceMeters: clippedEnd,
    lengthMeters: clippedLength,
    totalAscentMeters: Math.round(clippedAscent * 10) / 10,
    averageGradientPercent: Math.round(clippedAverageGradient * 10) / 10,
    difficultyScore: Math.round(clippedDifficultyScore * 10) / 10,
    effectiveDistanceMeters: effectiveStartDistanceMeters,
    effectiveStartDistanceMeters,
    effectiveEndDistanceMeters,
  };
}
