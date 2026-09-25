import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouteStore } from "@/store/routeStore";
import { useFerryStore } from "@/store/ferryStore";
import { buildRouteDetailPresentation, startRouteDetailLoad } from "@/services/routeDetailModel";
import type { FerryCrossing, RouteDetailLoadState } from "@/types";

const EMPTY_FERRIES: FerryCrossing[] = [];

export function useRouteDetailModel(id: string | undefined) {
  const routeId = id ?? null;
  const getRouteDetail = useRouteStore((state) => state.getRouteDetail);
  const loadFerries = useFerryStore((state) => state.loadFerries);
  const routeFerries = useFerryStore((state) =>
    routeId ? (state.ferries[routeId] ?? EMPTY_FERRIES) : EMPTY_FERRIES,
  );
  const [loadState, setLoadState] = useState<RouteDetailLoadState>({
    routeId,
    route: null,
    loading: routeId != null,
    error: null,
  });
  const [reloadVersion, setReloadVersion] = useState(0);
  const retry = useCallback(() => setReloadVersion((version) => version + 1), []);

  useEffect(
    () => startRouteDetailLoad(routeId, getRouteDetail, loadFerries, setLoadState),
    [routeId, getRouteDetail, loadFerries, reloadVersion],
  );

  // Hide the previous route immediately, before the new route's effect has run.
  const matchesRoute = loadState.routeId === routeId;
  const route = matchesRoute ? loadState.route : null;
  const presentation = useMemo(
    () => buildRouteDetailPresentation(route, routeFerries),
    [route, routeFerries],
  );

  return {
    route,
    loading: matchesRoute ? loadState.loading : routeId != null,
    error: matchesRoute ? loadState.error : null,
    retry,
    routeFerries,
    ...presentation,
  };
}
