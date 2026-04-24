import { getRouteWithPoints, getCollectionSegments } from "@/db/database";
import { toDisplayPOI } from "@/services/displayDistance";
import type { StitchedCollection, StitchedSegmentInfo, RoutePoint, POI, DisplayPOI } from "@/types";

export async function stitchCollection(collectionId: string): Promise<StitchedCollection> {
  const allSegments = await getCollectionSegments(collectionId);
  const selected = allSegments.filter((s) => s.isSelected);
  selected.sort((a, b) => a.position - b.position);

  // Load all segment routes in parallel
  const routeResults = await Promise.all(selected.map((seg) => getRouteWithPoints(seg.routeId)));

  const stitchedPoints: RoutePoint[] = [];
  const segmentInfos: StitchedSegmentInfo[] = [];
  const pointsByRouteId: Record<string, RoutePoint[]> = {};
  let cumulativeDistance = 0;
  let globalIndex = 0;
  let totalAscent = 0;
  let totalDescent = 0;

  for (let i = 0; i < selected.length; i++) {
    const route = routeResults[i];
    if (!route) continue;

    const points = route.points;
    pointsByRouteId[route.id] = points;
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
): DisplayPOI[] {
  const combined: DisplayPOI[] = [];

  for (const seg of segments) {
    const pois = poisByRoute[seg.routeId];
    if (!pois) continue;

    for (const poi of pois) {
      combined.push(toDisplayPOI(poi, seg.distanceOffsetMeters));
    }
  }

  combined.sort((a, b) => a.effectiveDistanceMeters - b.effectiveDistanceMeters);
  return combined;
}
