import { useMemo } from "react";
import { useRouteStore } from "@/store/routeStore";
import { useRaceStore } from "@/store/raceStore";
import type { ActiveRouteData, Race, Route, RoutePoint, StitchedRace } from "@/types";

function buildActiveRouteData(
  races: Race[],
  activeStitchedRace: StitchedRace | null,
  routes: Route[],
  visibleRoutePoints: Record<string, RoutePoint[]>,
): ActiveRouteData | null {
  const activeRace = races.find((r) => r.isActive);
  if (activeRace && activeStitchedRace) {
    return {
      type: "race",
      id: activeRace.id,
      name: activeRace.name,
      points: activeStitchedRace.points,
      totalDistanceMeters: activeStitchedRace.totalDistanceMeters,
      totalAscentMeters: activeStitchedRace.totalAscentMeters,
      totalDescentMeters: activeStitchedRace.totalDescentMeters,
      segments: activeStitchedRace.segments,
      routeIds: activeStitchedRace.segments.map((s) => s.routeId),
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
  const races = useRaceStore((s) => s.races);
  const activeStitchedRace = useRaceStore((s) => s.activeStitchedRace);

  return useMemo(
    () => buildActiveRouteData(races, activeStitchedRace, routes, visibleRoutePoints),
    [routes, visibleRoutePoints, races, activeStitchedRace],
  );
}

/**
 * Get active route data imperatively (outside React render).
 * Used in callbacks like snapAfterRefresh.
 */
export function getActiveRouteDataImperative(): ActiveRouteData | null {
  return buildActiveRouteData(
    useRaceStore.getState().races,
    useRaceStore.getState().activeStitchedRace,
    useRouteStore.getState().routes,
    useRouteStore.getState().visibleRoutePoints,
  );
}
