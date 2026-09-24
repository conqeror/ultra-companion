import type { FerryCrossing, RouteDetailLoadState, RouteWithPoints } from "@/types";
import {
  computeRidingElevationTotals,
  toDisplayFerryCrossing,
  totalRidingDistanceMeters,
} from "./ferryCrossings";
import { buildFerryAwarePreviewLayers } from "@/utils/ferryMapRoute";

/** One screen load; cleanup prevents an old route or failure replacing the current screen. */
export function startRouteDetailLoad(
  routeId: string | null,
  getRouteDetail: (id: string) => Promise<RouteWithPoints | null>,
  loadFerries: (id: string) => Promise<void>,
  onChange: (state: RouteDetailLoadState) => void,
): () => void {
  let cancelled = false;
  onChange({ routeId, route: null, loading: routeId != null, error: null });

  if (routeId != null) {
    void (async () => {
      try {
        const [route] = await Promise.all([getRouteDetail(routeId), loadFerries(routeId)]);
        if (!cancelled) onChange({ routeId, route, loading: false, error: null });
      } catch (error) {
        if (cancelled) return;
        console.warn("Failed to load route detail:", error);
        onChange({
          routeId,
          route: null,
          loading: false,
          error: "Could not load route data. Please try again.",
        });
      }
    })();
  }

  return () => {
    cancelled = true;
  };
}

/** Shared route overview; platform screens add their own controls and profile overlays. */
export function buildRouteDetailPresentation(
  route: RouteWithPoints | null,
  routeFerries: FerryCrossing[],
) {
  const displayFerries = route
    ? routeFerries.map((crossing) =>
        toDisplayFerryCrossing(
          crossing,
          crossing.startDistanceMeters,
          crossing.endDistanceMeters,
          0,
          route.points,
        ),
      )
    : [];
  const previewLayers = buildFerryAwarePreviewLayers(
    route?.points.length
      ? [{ id: route.id, cacheKey: route.id, points: route.points, isActive: true }]
      : [],
    displayFerries,
  );
  const elevation = route ? computeRidingElevationTotals(route.points, routeFerries) : null;
  const ridingStats =
    route && elevation
      ? {
          distance: totalRidingDistanceMeters(route.totalDistanceMeters, routeFerries),
          ascent: elevation.ascent,
          descent: elevation.descent,
        }
      : null;

  return { displayFerries, previewLayers, ridingStats };
}
