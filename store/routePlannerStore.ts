import { create } from "zustand";
import { fetchBRouterRoute, isRoutingWaypoint } from "@/services/brouterClient";
import { useRouteStore } from "@/store/routeStore";
import type { BRouterProfile, ParsedRoute, Route, RoutingWaypoint } from "@/types";
import { getSelectedBRouterProfile, useBRouterProfileStore } from "@/store/brouterProfileStore";

interface RoutePlannerState {
  profile: BRouterProfile | null;
  setProfile: (profile: BRouterProfile | null) => void;
  waypoints: RoutingWaypoint[];
  preview: ParsedRoute | null;
  isRouting: boolean;
  isSaving: boolean;
  savedRoute: Route | null;
  error: string | null;
  addWaypoint: (point: RoutingWaypoint) => void;
  undo: () => void;
  reset: () => void;
  calculate: () => Promise<void>;
  save: (name: string) => Promise<Route | null>;
}

let request: AbortController | null = null;
let generation = 0;

function cancelRequest() {
  generation += 1;
  request?.abort();
  request = null;
}

export const useRoutePlannerStore = create<RoutePlannerState>((set, get) => {
  const replaceWaypoints = (waypoints: RoutingWaypoint[]) => {
    if (get().isSaving || get().savedRoute) return;
    cancelRequest();
    set({ waypoints, preview: null, error: null, isRouting: false });
  };
  return {
    profile: getSelectedBRouterProfile(),
    setProfile: (profile) => {
      if (get().profile === profile) return;
      cancelRequest();
      set({ profile, preview: null, error: null, isRouting: false });
    },
    waypoints: [],
    preview: null,
    error: null,
    isRouting: false,
    isSaving: false,
    savedRoute: null,
    addWaypoint: (point) => {
      if (!isRoutingWaypoint(point)) return;
      const last = get().waypoints.at(-1);
      if (last?.latitude === point.latitude && last.longitude === point.longitude) return;
      replaceWaypoints([...get().waypoints, point]);
    },
    undo: () => replaceWaypoints(get().waypoints.slice(0, -1)),
    reset: () => {
      if (get().isSaving) return;
      cancelRequest();
      set({ waypoints: [], preview: null, error: null, isRouting: false, savedRoute: null });
    },
    calculate: async () => {
      const { waypoints, isSaving, savedRoute, profile } = get();
      if (waypoints.length < 2 || isSaving || savedRoute) return;
      cancelRequest();
      const currentGeneration = generation;
      request = new AbortController();
      const signal = request.signal;
      set({ isRouting: true, preview: null, error: null });
      try {
        const preview = await fetchBRouterRoute(waypoints, signal, profile);
        if (generation === currentGeneration) set({ preview, isRouting: false });
      } catch (error) {
        if (generation === currentGeneration) {
          set({
            isRouting: false,
            error: error instanceof Error ? error.message : "Could not plan this route. Try again.",
          });
        }
      } finally {
        if (generation === currentGeneration) request = null;
      }
    },
    save: async (name) => {
      const { preview, isRouting, isSaving, savedRoute } = get();
      if (savedRoute) return savedRoute;
      if (!preview || isRouting || isSaving || !name.trim()) return null;
      set({ isSaving: true, error: null });
      try {
        const route = await useRouteStore
          .getState()
          .saveParsedRoute({ ...preview, name: name.trim() }, "planned-route.gpx");
        set({ savedRoute: route });
        return route;
      } catch (error) {
        set({
          error: error instanceof Error ? error.message : "Could not save this route. Try again.",
        });
        return null;
      } finally {
        set({ isSaving: false });
      }
    },
  };
});

// Invalidate synchronously on selection, edits, or deletion, before an old preview can be saved.
useBRouterProfileStore.subscribe(() => {
  useRoutePlannerStore.getState().setProfile(getSelectedBRouterProfile());
});
