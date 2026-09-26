import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BRouterProfile, ParsedRoute } from "@/types";

const { fetchRoute, uploadProfile, saveParsedRoute } = vi.hoisted(() => ({
  fetchRoute: vi.fn(),
  uploadProfile: vi.fn(),
  saveParsedRoute: vi.fn(),
}));
vi.mock("@/services/brouterClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/brouterClient")>()),
  fetchBRouterRoute: fetchRoute,
  uploadBRouterProfile: uploadProfile,
}));
vi.mock("@/store/routeStore", () => ({ useRouteStore: { getState: () => ({ saveParsedRoute }) } }));
import { useRoutePlannerStore } from "@/store/routePlannerStore";
import { parseBRouterRoute } from "@/services/brouterClient";
import { useBRouterProfileStore } from "@/store/brouterProfileStore";

const first = { longitude: 17.1, latitude: 48.1 };
const second = { longitude: 17.2, latitude: 48.2 };
const third = { longitude: 17.3, latitude: 48.3 };
const quietProfile: BRouterProfile = { id: "quiet", name: "Quiet roads", content: "source" };

function preview(midpointLatitude = 48.15): ParsedRoute {
  return parseBRouterRoute({
    type: "FeatureCollection",
    features: [
      {
        geometry: {
          type: "LineString",
          coordinates: [
            [17.1, 48.1, 100],
            [17.15, midpointLatitude, 250],
            [17.2, 48.2, 200],
          ],
        },
      },
    ],
  });
}

const primary = preview();
const alternative = preview(48.25);
const state = () => useRoutePlannerStore.getState();

function addPoints() {
  state().addWaypoint(first);
  state().addWaypoint(second);
}

describe("route planner comparison", () => {
  beforeEach(() => {
    state().reset();
    useBRouterProfileStore.setState({ profiles: [], selectedProfileId: null });
    state().setSelectedProfileIds([null]);
    fetchRoute.mockReset().mockResolvedValue(primary);
    uploadProfile.mockReset().mockResolvedValue("custom_quiet");
    saveParsedRoute.mockReset();
  });

  it("calculates selected profiles independently and preserves partial success", async () => {
    useBRouterProfileStore.setState({ profiles: [quietProfile], selectedProfileId: null });
    state().setSelectedProfileIds([null, quietProfile.id]);
    fetchRoute.mockImplementation((_points, _signal, profile: BRouterProfile | null) =>
      profile ? Promise.reject(new Error("Profile failed")) : Promise.resolve(primary),
    );
    addPoints();
    await state().calculate();

    expect(state().candidates).toHaveLength(1);
    expect(state().candidates[0]).toMatchObject({
      id: "builtin:0",
      profileId: null,
      profileName: "Road cycling",
      alternativeIndex: 0,
    });
    expect(state().selectedCandidateId).toBe("builtin:0");
    expect(state().profileErrors.quiet).toBe("Profile failed");
    expect(uploadProfile).toHaveBeenCalledOnce();
    expect(fetchRoute).toHaveBeenCalledWith(
      [first, second],
      expect.any(AbortSignal),
      quietProfile,
      0,
      "custom_quiet",
    );

    fetchRoute.mockResolvedValue(alternative);
    await state().calculate();
    expect(state().candidates.map((candidate) => candidate.id)).toEqual(["builtin:0", "quiet:0"]);
    expect(state().profileErrors).toEqual({});
    expect(fetchRoute).toHaveBeenCalledTimes(3);
  });

  it("loads alternatives sequentially, reuses one upload, and removes duplicates", async () => {
    useBRouterProfileStore.setState({
      profiles: [quietProfile],
      selectedProfileId: quietProfile.id,
    });
    state().setSelectedProfileIds([quietProfile.id]);
    fetchRoute.mockImplementation((_points, _signal, _profile, alternativeIndex: 0 | 1 | 2 | 3) => {
      if (alternativeIndex === 1 || alternativeIndex === 2) return Promise.resolve(alternative);
      if (alternativeIndex === 3) return Promise.reject(new Error("No third route"));
      return Promise.resolve(primary);
    });
    addPoints();
    await state().calculate();
    await state().loadAlternatives(quietProfile.id);

    expect(fetchRoute.mock.calls.map((call) => call[3])).toEqual([0, 1, 2, 3]);
    expect(uploadProfile).toHaveBeenCalledTimes(2);
    expect(state().candidates.map((candidate) => candidate.alternativeIndex)).toEqual([0, 1]);
    expect(state().alternativeErrors.quiet).toContain("Alternative 3");
    expect(state().loadedAlternativeProfileIds).toContain(quietProfile.id);
  });

  it("invalidates all candidates and pending work when waypoints change", async () => {
    let finishOld!: (route: ParsedRoute) => void;
    fetchRoute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    addPoints();
    const old = state().calculate();
    await vi.waitFor(() => expect(fetchRoute).toHaveBeenCalledOnce());
    const signal = fetchRoute.mock.calls[0][1] as AbortSignal;
    state().addWaypoint(third);
    expect(signal.aborted).toBe(true);
    expect(state().candidates).toEqual([]);
    finishOld(primary);
    await old;
    expect(state().candidates).toEqual([]);
    expect(await state().save("Stale route")).toBeNull();
  });

  it("invalidates selected custom-profile candidates after edits or deletion", async () => {
    useBRouterProfileStore.setState({
      profiles: [quietProfile],
      selectedProfileId: quietProfile.id,
    });
    state().setSelectedProfileIds([quietProfile.id]);
    addPoints();
    await state().calculate();
    expect(state().candidates).toHaveLength(1);

    useBRouterProfileStore.setState({
      profiles: [{ ...quietProfile, content: "edited" }],
      selectedProfileId: quietProfile.id,
    });
    expect(state().candidates).toEqual([]);
    expect(await state().save("Stale route")).toBeNull();

    useBRouterProfileStore.setState({ profiles: [], selectedProfileId: null });
    expect(state().selectedProfileIds).toEqual([null]);
  });

  it("preserves points after complete routing failure and supports retry", async () => {
    fetchRoute.mockRejectedValueOnce(new Error("No connection"));
    addPoints();
    await state().calculate();
    expect(state()).toMatchObject({
      waypoints: [first, second],
      candidates: [],
      profileErrors: { builtin: "No connection" },
      isRouting: false,
    });
    await state().calculate();
    expect(state().candidates[0].route).toBe(primary);
  });

  it("saves only the selected candidate and keeps it available after a failed save", async () => {
    useBRouterProfileStore.setState({ profiles: [quietProfile], selectedProfileId: null });
    state().setSelectedProfileIds([null, quietProfile.id]);
    fetchRoute.mockImplementation((_points, _signal, profile: BRouterProfile | null) =>
      Promise.resolve(profile ? alternative : primary),
    );
    saveParsedRoute
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValueOnce({ id: "saved" });
    addPoints();
    await state().calculate();
    state().selectCandidate("quiet:0");

    expect(await state().save("Evening ride")).toBeNull();
    expect(state()).toMatchObject({ error: "Disk full", isSaving: false });
    expect(await state().save("  Evening ride  ")).toEqual({ id: "saved" });
    expect(saveParsedRoute).toHaveBeenLastCalledWith(
      { ...alternative, name: "Evening ride" },
      "planned-route.gpx",
    );
  });

  it("blocks duplicate saves and draft edits during persistence", async () => {
    let finish!: (route: { id: string }) => void;
    saveParsedRoute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    addPoints();
    await state().calculate();
    const saving = state().save("Morning ride");
    expect(await state().save("Morning ride")).toBeNull();
    state().addWaypoint(third);
    state().undo();
    state().reset();
    expect(state().waypoints).toEqual([first, second]);
    finish({ id: "saved" });
    await saving;
    expect(await state().save("Morning ride")).toEqual({ id: "saved" });
    expect(saveParsedRoute).toHaveBeenCalledTimes(1);
  });
});
