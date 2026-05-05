import type { Collection, StitchedCollection } from "@/types";

export interface MockCollectionStoreState {
  collections: Collection[];
  activeStitchedCollection: StitchedCollection | null;
}

export function createCollectionStoreMockState(): MockCollectionStoreState {
  return {
    collections: [],
    activeStitchedCollection: null,
  };
}

export function resetCollectionStoreMockState(state: MockCollectionStoreState): void {
  state.collections = [];
  state.activeStitchedCollection = null;
}
