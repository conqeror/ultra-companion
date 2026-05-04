import { getRouteWithPoints, getCollectionSegments } from "@/db/database";
import { toDisplayPOI } from "@/services/displayDistance";
import { isDistanceInWindow, type DistanceWindow } from "@/utils/ridingHorizon";
import type { StitchedCollection, StitchedSegmentInfo, RoutePoint, POI, DisplayPOI } from "@/types";

interface StitchCollectionOptions {
  /** Keep raw per-segment point arrays in the returned view model. */
  includePointsByRouteId?: boolean;
}

export async function stitchCollection(
  collectionId: string,
  options: StitchCollectionOptions = {},
): Promise<StitchedCollection> {
  const allSegments = await getCollectionSegments(collectionId);
  const selected = allSegments.filter((s) => s.isSelected);
  selected.sort((a, b) => a.position - b.position);

  const stitchedPoints: RoutePoint[] = [];
  const segmentInfos: StitchedSegmentInfo[] = [];
  const pointsByRouteId: Record<string, RoutePoint[]> = {};
  let cumulativeDistance = 0;
  let globalIndex = 0;
  let totalAscent = 0;
  let totalDescent = 0;

  for (let i = 0; i < selected.length; i++) {
    const route = await getRouteWithPoints(selected[i].routeId);
    if (!route) continue;

    const points = route.points;
    if (options.includePointsByRouteId ?? true) {
      pointsByRouteId[route.id] = points;
    }
    const startPointIndex = globalIndex;

    for (const pt of points) {
      stitchedPoints.push({
        latitude: pt.latitude,
        longitude: pt.longitude,
        elevationMeters: pt.elevationMeters,
        distanceFromStartMeters: pt.distanceFromStartMeters + cumulativeDistance,
        idx: globalIndex,
      });
      globalIndex++;
    }

    const endPointIndex = globalIndex - 1;

    segmentInfos.push({
      routeId: route.id,
      routeName: route.name,
      position: selected[i].position,
      startPointIndex,
      endPointIndex,
      distanceOffsetMeters: cumulativeDistance,
      segmentDistanceMeters: route.totalDistanceMeters,
      segmentAscentMeters: route.totalAscentMeters,
      segmentDescentMeters: route.totalDescentMeters,
    });

    cumulativeDistance += route.totalDistanceMeters;
    totalAscent += route.totalAscentMeters;
    totalDescent += route.totalDescentMeters;
  }

  return {
    collectionId,
    points: stitchedPoints,
    segments: segmentInfos,
    totalDistanceMeters: cumulativeDistance,
    totalAscentMeters: totalAscent,
    totalDescentMeters: totalDescent,
    pointsByRouteId,
  };
}

export function stitchPOIs(
  segments: StitchedSegmentInfo[],
  poisByRoute: Record<string, POI[]>,
  window?: DistanceWindow,
): DisplayPOI[] {
  const combined: DisplayPOI[] = [];

  for (const seg of segments) {
    const pois = poisByRoute[seg.routeId];
    if (!pois) continue;

    for (const poi of pois) {
      const effectiveDistanceMeters = poi.distanceAlongRouteMeters + seg.distanceOffsetMeters;
      if (!isDistanceInWindow(effectiveDistanceMeters, window)) continue;
      combined.push(toDisplayPOI(poi, seg.distanceOffsetMeters));
    }
  }

  combined.sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
  return combined;
}
