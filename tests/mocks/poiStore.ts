import type { POI } from "@/types";

export interface MockPoiStoreState {
  pois: Record<string, POI[]>;
}

export function createPoiStoreMockState(): MockPoiStoreState {
  return {
    pois: {},
  };
}

export function resetPoiStoreMockState(state: MockPoiStoreState): void {
  state.pois = {};
}
