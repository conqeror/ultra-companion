export interface PlanningDataRefreshDependencies {
  clearRouteViewState: () => void;
  clearPoiViewState: () => void;
  clearClimbCache: () => void;
  clearFerryCache: () => void;
  loadRouteMetadata: () => Promise<void>;
  activeStandaloneRouteId: () => string | null;
  loadRoutePoints: (routeIds: string[], options: { prune: true }) => Promise<void>;
  loadCollections: () => Promise<void>;
  loadStarredItems: () => Promise<void>;
}

export async function refreshPlanningData(
  dependencies: PlanningDataRefreshDependencies,
): Promise<void> {
  dependencies.clearRouteViewState();
  dependencies.clearPoiViewState();
  dependencies.clearClimbCache();
  dependencies.clearFerryCache();

  await dependencies.loadRouteMetadata();
  const activeStandaloneRouteId = dependencies.activeStandaloneRouteId();

  await Promise.all([
    dependencies.loadRoutePoints(activeStandaloneRouteId ? [activeStandaloneRouteId] : [], {
      prune: true,
    }),
    dependencies.loadCollections(),
    dependencies.loadStarredItems(),
  ]);
}

/**
 * Reconcile in-memory state after importing a planner database without
 * recreating the old "every visible route has points" memory shape.
 *
 * Collections own their selected stitched geometry. A standalone active route
 * is the only route allowed into the route point cache during this refresh.
 */
export async function refreshPlanningDataAfterImport(): Promise<void> {
  const [
    { useClimbStore },
    { useCollectionStore },
    { useFerryStore },
    { usePoiStore },
    { useRouteStore },
  ] = await Promise.all([
    import("@/store/climbStore"),
    import("@/store/collectionStore"),
    import("@/store/ferryStore"),
    import("@/store/poiStore"),
    import("@/store/routeStore"),
  ]);

  await refreshPlanningData({
    clearRouteViewState: () =>
      useRouteStore.setState({ visibleRoutePoints: {}, snappedPosition: null, snapHistory: [] }),
    clearPoiViewState: () => usePoiStore.setState({ pois: {}, selectedPOI: null }),
    clearClimbCache: () => useClimbStore.getState().clearClimbCache(),
    clearFerryCache: () => useFerryStore.getState().clearFerryCache(),
    loadRouteMetadata: () => useRouteStore.getState().loadRouteMetadata(),
    activeStandaloneRouteId: () =>
      useRouteStore.getState().routes.find((route) => route.isActive)?.id ?? null,
    loadRoutePoints: (routeIds, options) =>
      useRouteStore.getState().loadRoutePoints(routeIds, options),
    loadCollections: () => useCollectionStore.getState().loadCollections(),
    loadStarredItems: () => usePoiStore.getState().loadStarredItems(),
  });
}
