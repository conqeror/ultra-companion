import { useMemo } from "react";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import { useFerryStore } from "@/store/ferryStore";
import { getStitchedSourceRouteIds } from "@/services/stitchingService";
import { mapFerryCrossingsToSourceSpans } from "@/services/ferryCrossings";
import type {
  ActiveRouteData,
  Collection,
  FerryCrossing,
  Route,
  RoutePoint,
  StitchedCollection,
} from "@/types";

function buildActiveRouteData(
  collections: Collection[],
  activeStitchedCollection: StitchedCollection | null,
  routes: Route[],
  visibleRoutePoints: Record<string, RoutePoint[]>,
  ferriesByRouteId: Record<string, FerryCrossing[]>,
): ActiveRouteData | null {
  const activeCollection = collections.find((c) => c.isActive);
  if (activeCollection && activeStitchedCollection?.collectionId === activeCollection.id) {
    const routeIds = getStitchedSourceRouteIds(activeStitchedCollection.segments);
    return {
      type: "collection",
      id: activeCollection.id,
      name: activeCollection.name,
      points: activeStitchedCollection.points,
      totalDistanceMeters: activeStitchedCollection.totalDistanceMeters,
      totalAscentMeters: activeStitchedCollection.totalAscentMeters,
      totalDescentMeters: activeStitchedCollection.totalDescentMeters,
      segments: activeStitchedCollection.segments,
      routeIds,
      pointsByRouteId: activeStitchedCollection.pointsByRouteId,
      ferries: mapFerryCrossingsToSourceSpans(
        routeIds.flatMap((routeId) => ferriesByRouteId[routeId] ?? []),
        activeStitchedCollection.sourceSpans,
        activeStitchedCollection.pointsByRouteId,
      ),
    };
  }

  const activeRoute = routes.find((r) => r.isActive);
  if (activeRoute && visibleRoutePoints[activeRoute.id]) {
    return {
      type: "route",
      id: activeRoute.id,
      name: activeRoute.name,
      points: visibleRoutePoints[activeRoute.id],
      totalDistanceMeters: activeRoute.totalDistanceMeters,
      totalAscentMeters: activeRoute.totalAscentMeters,
      totalDescentMeters: activeRoute.totalDescentMeters,
      segments: null,
      routeIds: [activeRoute.id],
      pointsByRouteId: { [activeRoute.id]: visibleRoutePoints[activeRoute.id] },
      ferries: mapFerryCrossingsToSourceSpans(ferriesByRouteId[activeRoute.id] ?? [], null),
    };
  }

  return null;
}

export function useActiveRouteData(): ActiveRouteData | null {
  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const collections = useCollectionStore((s) => s.collections);
  const activeStitchedCollection = useCollectionStore((s) => s.activeStitchedCollection);
  const ferriesByRouteId = useFerryStore((s) => s.ferries);

  return useMemo(
    () =>
      buildActiveRouteData(
        collections,
        activeStitchedCollection,
        routes,
        visibleRoutePoints,
        ferriesByRouteId,
      ),
    [routes, visibleRoutePoints, collections, activeStitchedCollection, ferriesByRouteId],
  );
}

/**
 * Get active route data imperatively (outside React render).
 * Used in callbacks like snapAfterRefresh.
 */
export function getActiveRouteDataImperative(): ActiveRouteData | null {
  return buildActiveRouteData(
    useCollectionStore.getState().collections,
    useCollectionStore.getState().activeStitchedCollection,
    useRouteStore.getState().routes,
    useRouteStore.getState().visibleRoutePoints,
    useFerryStore.getState().ferries,
  );
}
