import {
  createCollectionStoreMockState,
  resetCollectionStoreMockState,
  type MockCollectionStoreState,
} from "@/tests/mocks/collectionStore";
import {
  createPoiStoreMockState,
  resetPoiStoreMockState,
  type MockPoiStoreState,
} from "@/tests/mocks/poiStore";
import {
  createRouteStoreMockState,
  resetRouteStoreMockState,
  type MockRouteStoreState,
} from "@/tests/mocks/routeStore";

export interface StitchedCollectionHarness {
  routeState: MockRouteStoreState;
  collectionState: MockCollectionStoreState;
  poiState: MockPoiStoreState;
  reset: () => void;
}

export function createStitchedCollectionHarness(): StitchedCollectionHarness {
  const routeState = createRouteStoreMockState();
  const collectionState = createCollectionStoreMockState();
  const poiState = createPoiStoreMockState();

  return {
    routeState,
    collectionState,
    poiState,
    reset: () => {
      resetRouteStoreMockState(routeState);
      resetCollectionStoreMockState(collectionState);
      resetPoiStoreMockState(poiState);
    },
  };
}
