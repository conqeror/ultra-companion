import { create } from "zustand";
import type { SharedPOIInput } from "@/services/sharedPOIService";

interface SharedPOIState {
  pendingSharedPOI: SharedPOIInput | null;
  setPendingSharedPOI: (input: SharedPOIInput) => void;
  consumePendingSharedPOI: (id: string) => void;
}

export const useSharedPOIStore = create<SharedPOIState>((set, get) => ({
  pendingSharedPOI: null,
  setPendingSharedPOI: (pendingSharedPOI) => set({ pendingSharedPOI }),
  consumePendingSharedPOI: (id) => {
    if (get().pendingSharedPOI?.id !== id) return;
    set({ pendingSharedPOI: null });
  },
}));
