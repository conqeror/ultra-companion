import { useMemo } from "react";
import { useRouteStore } from "@/store/routeStore";
import { useCollectionStore } from "@/store/collectionStore";
import type { ActiveRouteData, Collection, Route, RoutePoint, StitchedCollection } from "@/types";

function buildActiveRouteData(
  collections: Collection[],
  activeStitchedCollection: StitchedCollection | null,
  routes: Route[],
  visibleRoutePoints: Record<string, RoutePoint[]>,
): ActiveRouteData | null {
  const activeCollection = collections.find((c) => c.isActive);
  if (activeCollection && activeStitchedCollection) {
    return {
      type: "collection",
      id: activeCollection.id,
      name: activeCollection.name,
      points: activeStitchedCollection.points,
      totalDistanceMeters: activeStitchedCollection.totalDistanceMeters,
      totalAscentMeters: activeStitchedCollection.totalAscentMeters,
      totalDescentMeters: activeStitchedCollection.totalDescentMeters,
      segments: activeStitchedCollection.segments,
      routeIds: activeStitchedCollection.segments.map((s) => s.routeId),
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
    };
  }

  return null;
}

export function useActiveRouteData(): ActiveRouteData | null {
  const routes = useRouteStore((s) => s.routes);
  const visibleRoutePoints = useRouteStore((s) => s.visibleRoutePoints);
  const collections = useCollectionStore((s) => s.collections);
  const activeStitchedCollection = useCollectionStore((s) => s.activeStitchedCollection);

  return useMemo(
    () => buildActiveRouteData(collections, activeStitchedCollection, routes, visibleRoutePoints),
    [routes, visibleRoutePoints, collections, activeStitchedCollection],
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
  );
}
