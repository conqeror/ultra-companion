import { useCallback, useEffect, useRef } from "react";
import { AppState } from "react-native";
import { GPS_STALE_THRESHOLD_MS } from "@/constants";
import { getActiveRouteDataImperative } from "./useActiveRouteData";
import { useMapStore } from "@/store/mapStore";
import { useRouteStore } from "@/store/routeStore";
import { refreshActiveRoutePosition } from "@/services/activeRouteSession";
import { snapToRouteDetailed } from "@/services/routeSnapping";
import type { ActiveRouteData, RoutePoint, UserPosition } from "@/types";

function applyRouteSnap(position: UserPosition, route: { id: string; points: RoutePoint[] }) {
  const state = useRouteStore.getState();
  const previous = state.snappedPosition;
  const snapped = snapToRouteDetailed(
    position.latitude,
    position.longitude,
    route.id,
    route.points,
    {
      previousPointIndex: previous?.routeId === route.id ? previous.pointIndex : undefined,
      previousDistanceAlongRouteMeters:
        previous?.routeId === route.id ? previous.distanceAlongRouteMeters : undefined,
      history: state.snapHistory,
      headingDegrees: position.heading,
      speedMetersPerSecond: position.speed,
      timestamp: position.timestamp,
    },
  );
  if (!snapped) {
    state.clearRouteProgress();
    return;
  }
  state.setSnappedPosition(snapped.snappedPosition);
  state.recordSnapHistory({
    routeId: route.id,
    latitude: position.latitude,
    longitude: position.longitude,
    timestamp: position.timestamp,
    heading: position.heading,
    speed: position.speed,
    selectedCandidate: snapped.selectedCandidate,
  });
}

/** On-demand GPS on mount, explicit Locate, and foregrounding with a stale fix. */
export function useActiveRoutePosition(activeData: ActiveRouteData | null) {
  const refreshPosition = useMapStore((state) => state.refreshPosition);
  const mounted = useRef(false);
  const refreshAndSnap = useCallback(
    () =>
      refreshActiveRoutePosition(
        refreshPosition,
        getActiveRouteDataImperative,
        applyRouteSnap,
        () => mounted.current,
      ),
    [refreshPosition],
  );

  const routeId = activeData?.id;
  const points = activeData?.points;
  useEffect(() => {
    const position = useMapStore.getState().userPosition;
    if (position && routeId && points?.length) applyRouteSnap(position, { id: routeId, points });
  }, [routeId, points]);

  useEffect(() => {
    mounted.current = true;
    const refresh = () =>
      void refreshAndSnap().catch((error) => {
        console.warn("Failed to refresh route position:", error);
      });
    refresh();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      const position = useMapStore.getState().userPosition;
      if (!position || Date.now() - position.timestamp >= GPS_STALE_THRESHOLD_MS) refresh();
    });
    return () => {
      mounted.current = false;
      subscription.remove();
    };
  }, [refreshAndSnap]);

  return refreshAndSnap;
}
