import type { RoutePoint, UserPosition } from "@/types";

interface ActiveRouteRestoreDependencies {
  loadRouteMetadata: () => Promise<void>;
  loadCollections: () => Promise<void>;
  activeStandaloneRouteId: () => string | null;
  loadRoutePoints: (ids: string[], options: { prune: true }) => Promise<void>;
}

/** Restore metadata first; only the active standalone route needs its raw points. */
export async function restoreActiveRouteSession(
  dependencies: ActiveRouteRestoreDependencies,
  isCurrent: () => boolean,
): Promise<void> {
  await Promise.all([dependencies.loadRouteMetadata(), dependencies.loadCollections()]);
  if (!isCurrent()) return;
  const routeId = dependencies.activeStandaloneRouteId();
  if (routeId) await dependencies.loadRoutePoints([routeId], { prune: true });
}

/** Resolve the active geometry after GPS completes, since the rider may switch plans meanwhile. */
export async function refreshActiveRoutePosition(
  refreshPosition: () => Promise<UserPosition | null>,
  getActiveRoute: () => { id: string; points: RoutePoint[] } | null,
  applySnap: (position: UserPosition, route: { id: string; points: RoutePoint[] }) => void,
  isCurrent: () => boolean,
): Promise<UserPosition | null> {
  const position = await refreshPosition();
  if (!position || !isCurrent()) return null;
  const route = getActiveRoute();
  if (route?.points.length) applySnap(position, route);
  return position;
}
