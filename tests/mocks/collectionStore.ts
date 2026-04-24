import type { StitchedCollection } from "@/types";

export interface MockCollectionStoreState {
  activeStitchedCollection: StitchedCollection | null;
}

export function createCollectionStoreMockState(): MockCollectionStoreState {
  return {
    activeStitchedCollection: null,
  };
}

export function resetCollectionStoreMockState(state: MockCollectionStoreState): void {
  state.activeStitchedCollection = null;
}
