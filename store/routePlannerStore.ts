import { create } from "zustand";
import {
  fetchBRouterRoute,
  isRoutingWaypoint,
  uploadBRouterProfile,
} from "@/services/brouterClient";
import {
  arePlannerRoutesEffectivelySame,
  routePlannerCandidateId,
  routePlannerProfileKey,
  sortPlannerCandidates,
} from "@/services/routePlannerComparison";
import { useRouteStore } from "@/store/routeStore";
import type {
  BRouterAlternativeIndex,
  BRouterProfile,
  Route,
  RoutePlannerCandidate,
  RoutingWaypoint,
} from "@/types";
import { useBRouterProfileStore } from "@/store/brouterProfileStore";

export const MAX_COMPARED_BROUTER_PROFILES = 3;

interface RoutePlannerState {
  selectedProfileIds: (string | null)[];
  setSelectedProfileIds: (profileIds: readonly (string | null)[]) => void;
  waypoints: RoutingWaypoint[];
  candidates: RoutePlannerCandidate[];
  selectedCandidateId: string | null;
  selectCandidate: (candidateId: string) => void;
  loadingProfileIds: (string | null)[];
  alternativeLoadingProfileIds: (string | null)[];
  loadedAlternativeProfileIds: (string | null)[];
  profileErrors: Record<string, string>;
  alternativeErrors: Record<string, string>;
  isRouting: boolean;
  isSaving: boolean;
  savedRoute: Route | null;
  error: string | null;
  addWaypoint: (point: RoutingWaypoint) => void;
  undo: () => void;
  reset: () => void;
  calculate: () => Promise<void>;
  loadAlternatives: (profileId: string | null) => Promise<void>;
  save: (name: string) => Promise<Route | null>;
  invalidateProfiles: () => void;
}

const requests = new Set<AbortController>();
let generation = 0;

function cancelRequests() {
  generation += 1;
  for (const request of requests) request.abort();
  requests.clear();
}

function initialProfileIds(): (string | null)[] {
  return [useBRouterProfileStore.getState().selectedProfileId];
}

function normalizeProfileIds(profileIds: readonly (string | null)[]): (string | null)[] {
  const available = new Set(
    useBRouterProfileStore.getState().profiles.map((profile) => profile.id),
  );
  const seen = new Set<string>();
  const normalized: (string | null)[] = [];
  for (const profileId of profileIds) {
    if (profileId !== null && !available.has(profileId)) continue;
    const key = routePlannerProfileKey(profileId);
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(profileId);
    if (normalized.length === MAX_COMPARED_BROUTER_PROFILES) break;
  }
  return normalized.length > 0 ? normalized : [null];
}

function getProfile(profileId: string | null): BRouterProfile | null | undefined {
  if (profileId === null) return null;
  return useBRouterProfileStore.getState().profiles.find((profile) => profile.id === profileId);
}

function profileName(profileId: string | null): string {
  return getProfile(profileId)?.name ?? "Road cycling";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Could not plan this route. Try again.";
}

function clearCandidateState() {
  return {
    candidates: [] as RoutePlannerCandidate[],
    selectedCandidateId: null,
    loadingProfileIds: [] as (string | null)[],
    alternativeLoadingProfileIds: [] as (string | null)[],
    loadedAlternativeProfileIds: [] as (string | null)[],
    profileErrors: {},
    alternativeErrors: {},
    error: null,
    isRouting: false,
  };
}

async function uploadedProfileId(
  profile: BRouterProfile | null,
  signal: AbortSignal,
): Promise<string | undefined> {
  return profile ? uploadBRouterProfile(profile, signal) : undefined;
}

export const useRoutePlannerStore = create<RoutePlannerState>((set, get) => {
  const replaceWaypoints = (waypoints: RoutingWaypoint[]) => {
    if (get().isSaving || get().savedRoute) return;
    cancelRequests();
    set({ waypoints, ...clearCandidateState() });
  };

  return {
    selectedProfileIds: initialProfileIds(),
    setSelectedProfileIds: (profileIds) => {
      if (get().isSaving || get().savedRoute) return;
      const normalized = normalizeProfileIds(profileIds);
      const current = get().selectedProfileIds;
      if (
        current.length === normalized.length &&
        current.every((profileId, index) => profileId === normalized[index])
      ) {
        return;
      }
      cancelRequests();
      set({ selectedProfileIds: normalized, ...clearCandidateState() });
    },
    waypoints: [],
    candidates: [],
    selectedCandidateId: null,
    selectCandidate: (candidateId) => {
      if (get().candidates.some((candidate) => candidate.id === candidateId)) {
        set({ selectedCandidateId: candidateId });
      }
    },
    loadingProfileIds: [],
    alternativeLoadingProfileIds: [],
    loadedAlternativeProfileIds: [],
    profileErrors: {},
    alternativeErrors: {},
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
      cancelRequests();
      set({ waypoints: [], savedRoute: null, ...clearCandidateState() });
    },
    calculate: async () => {
      const { waypoints, isSaving, savedRoute } = get();
      if (waypoints.length < 2 || isSaving || savedRoute) return;
      const selectedProfileIds = normalizeProfileIds(get().selectedProfileIds);
      const failedProfileIds = selectedProfileIds.filter((profileId) =>
        Boolean(get().profileErrors[routePlannerProfileKey(profileId)]),
      );
      const isPartialRetry = get().candidates.length > 0 && failedProfileIds.length > 0;
      const profileIdsToLoad = isPartialRetry ? failedProfileIds : selectedProfileIds;
      cancelRequests();
      const currentGeneration = generation;
      const request = new AbortController();
      requests.add(request);
      set((state) =>
        isPartialRetry
          ? {
              isRouting: true,
              loadingProfileIds: profileIdsToLoad,
              profileErrors: Object.fromEntries(
                Object.entries(state.profileErrors).filter(
                  ([key]) =>
                    !profileIdsToLoad.some(
                      (profileId) => routePlannerProfileKey(profileId) === key,
                    ),
                ),
              ),
              error: null,
            }
          : {
              ...clearCandidateState(),
              isRouting: true,
              loadingProfileIds: profileIdsToLoad,
            },
      );

      await Promise.all(
        profileIdsToLoad.map(async (profileId) => {
          const profile = getProfile(profileId);
          if (profile === undefined) return;
          const key = routePlannerProfileKey(profileId);
          try {
            const providerProfileId = await uploadedProfileId(profile, request.signal);
            const route = await fetchBRouterRoute(
              waypoints,
              request.signal,
              profile,
              0,
              providerProfileId,
            );
            if (generation !== currentGeneration) return;
            const candidate: RoutePlannerCandidate = {
              id: routePlannerCandidateId(profileId, 0),
              profileId,
              profileName: profileName(profileId),
              alternativeIndex: 0,
              route,
            };
            set((state) => ({
              candidates: sortPlannerCandidates(
                [...state.candidates.filter((item) => item.id !== candidate.id), candidate],
                selectedProfileIds,
              ),
              selectedCandidateId:
                state.selectedCandidateId ??
                (profileId === selectedProfileIds[0] ? candidate.id : null),
              loadingProfileIds: state.loadingProfileIds.filter((id) => id !== profileId),
            }));
          } catch (error) {
            if (generation !== currentGeneration) return;
            set((state) => ({
              profileErrors: { ...state.profileErrors, [key]: errorMessage(error) },
              loadingProfileIds: state.loadingProfileIds.filter((id) => id !== profileId),
            }));
          }
        }),
      );

      requests.delete(request);
      if (generation !== currentGeneration) return;
      set((state) => ({
        isRouting: false,
        loadingProfileIds: [],
        selectedCandidateId: state.selectedCandidateId ?? state.candidates[0]?.id ?? null,
      }));
    },
    loadAlternatives: async (profileId) => {
      const { waypoints, candidates, isSaving, savedRoute, alternativeLoadingProfileIds } = get();
      if (
        waypoints.length < 2 ||
        isSaving ||
        savedRoute ||
        alternativeLoadingProfileIds.length > 0 ||
        !candidates.some(
          (candidate) => candidate.profileId === profileId && candidate.alternativeIndex === 0,
        )
      ) {
        return;
      }
      const profile = getProfile(profileId);
      if (profile === undefined) return;
      const currentGeneration = generation;
      const request = new AbortController();
      requests.add(request);
      const key = routePlannerProfileKey(profileId);
      set((state) => ({
        alternativeLoadingProfileIds: [profileId],
        alternativeErrors: { ...state.alternativeErrors, [key]: "" },
      }));

      const failures: string[] = [];
      try {
        const providerProfileId = await uploadedProfileId(profile, request.signal);
        for (const alternativeIndex of [
          1, 2, 3,
        ] as const satisfies readonly BRouterAlternativeIndex[]) {
          if (generation !== currentGeneration || request.signal.aborted) break;
          const candidateId = routePlannerCandidateId(profileId, alternativeIndex);
          if (get().candidates.some((candidate) => candidate.id === candidateId)) continue;
          try {
            const route = await fetchBRouterRoute(
              waypoints,
              request.signal,
              profile,
              alternativeIndex,
              providerProfileId,
            );
            if (generation !== currentGeneration) break;
            const sameProfileCandidates = get().candidates.filter(
              (candidate) => candidate.profileId === profileId,
            );
            if (
              sameProfileCandidates.some((candidate) =>
                arePlannerRoutesEffectivelySame(candidate.route, route),
              )
            ) {
              continue;
            }
            const candidate: RoutePlannerCandidate = {
              id: candidateId,
              profileId,
              profileName: profileName(profileId),
              alternativeIndex,
              route,
            };
            set((state) => ({
              candidates: sortPlannerCandidates(
                [...state.candidates, candidate],
                state.selectedProfileIds,
              ),
            }));
          } catch (error) {
            if (generation !== currentGeneration || request.signal.aborted) break;
            failures.push(`Alternative ${alternativeIndex}: ${errorMessage(error)}`);
          }
        }
      } catch (error) {
        if (generation === currentGeneration && !request.signal.aborted) {
          failures.push(errorMessage(error));
        }
      } finally {
        requests.delete(request);
        if (generation === currentGeneration) {
          set((state) => ({
            alternativeLoadingProfileIds: state.alternativeLoadingProfileIds.filter(
              (id) => id !== profileId,
            ),
            alternativeErrors: {
              ...state.alternativeErrors,
              [key]: failures.join(" "),
            },
            loadedAlternativeProfileIds: state.loadedAlternativeProfileIds.includes(profileId)
              ? state.loadedAlternativeProfileIds
              : [...state.loadedAlternativeProfileIds, profileId],
          }));
        }
      }
    },
    save: async (name) => {
      const {
        candidates,
        selectedCandidateId,
        isRouting,
        isSaving,
        savedRoute,
        alternativeLoadingProfileIds,
      } = get();
      if (savedRoute) return savedRoute;
      const selected = candidates.find((candidate) => candidate.id === selectedCandidateId);
      if (
        !selected ||
        isRouting ||
        isSaving ||
        alternativeLoadingProfileIds.length > 0 ||
        !name.trim()
      )
        return null;
      set({ isSaving: true, error: null });
      try {
        const route = await useRouteStore
          .getState()
          .saveParsedRoute({ ...selected.route, name: name.trim() }, "planned-route.gpx");
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
    invalidateProfiles: () => {
      if (get().isSaving || get().savedRoute) return;
      cancelRequests();
      set({
        selectedProfileIds: normalizeProfileIds(get().selectedProfileIds),
        ...clearCandidateState(),
      });
    },
  };
});

// Profile edits/deletions invalidate every derived candidate before it can be saved.
useBRouterProfileStore.subscribe(() => {
  useRoutePlannerStore.getState().invalidateProfiles();
});
