import type { RoutePoint, SnappedPosition } from "@/types";

export interface MockRouteStoreState {
  snappedPosition: Pick<SnappedPosition, "pointIndex"> | null;
  visibleRoutePoints: Record<string, RoutePoint[]>;
}

export function createRouteStoreMockState(): MockRouteStoreState {
  return {
    snappedPosition: null,
    visibleRoutePoints: {},
  };
}

export function resetRouteStoreMockState(state: MockRouteStoreState): void {
  state.snappedPosition = null;
  state.visibleRoutePoints = {};
}
