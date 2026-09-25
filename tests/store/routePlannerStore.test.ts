import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedRoute } from "@/types";

const { fetchRoute, saveParsedRoute } = vi.hoisted(() => ({
  fetchRoute: vi.fn(),
  saveParsedRoute: vi.fn(),
}));
vi.mock("@/services/brouterClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/brouterClient")>()),
  fetchBRouterRoute: fetchRoute,
}));
vi.mock("@/store/routeStore", () => ({ useRouteStore: { getState: () => ({ saveParsedRoute }) } }));
import { useRoutePlannerStore } from "@/store/routePlannerStore";
import { parseBRouterRoute } from "@/services/brouterClient";

const first = { longitude: 17.1, latitude: 48.1 };
const second = { longitude: 17.2, latitude: 48.2 };
const third = { longitude: 17.3, latitude: 48.3 };
const preview = parseBRouterRoute({
  type: "FeatureCollection",
  features: [
    {
      geometry: {
        type: "LineString",
        coordinates: [
          [17.1, 48.1, 100],
          [17.2, 48.2, 200],
        ],
      },
    },
  ],
});
const state = () => useRoutePlannerStore.getState();
function addPoints() {
  state().addWaypoint(first);
  state().addWaypoint(second);
}

describe("route planner", () => {
  beforeEach(() => {
    state().reset();
    fetchRoute.mockReset().mockResolvedValue(preview);
    saveParsedRoute.mockReset();
  });

  it("immediately invalidates a preview when adding or undoing a waypoint", async () => {
    addPoints();
    await state().calculate();
    expect(state().preview).toBe(preview);
    state().addWaypoint(third);
    expect(state().preview).toBeNull();
    expect(await state().save("Stale route")).toBeNull();
    await state().calculate();
    state().undo();
    expect(state().waypoints).toEqual([first, second]);
    expect(state().preview).toBeNull();
    expect(saveParsedRoute).not.toHaveBeenCalled();
  });

  it("ignores obsolete completions even when the provider ignores cancellation", async () => {
    let finishOld!: (route: ParsedRoute) => void;
    fetchRoute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishOld = resolve;
        }),
    );
    addPoints();
    const old = state().calculate();
    const signal = fetchRoute.mock.calls[0][1] as AbortSignal;
    state().addWaypoint(third);
    await state().calculate();
    expect(signal.aborted).toBe(true);
    finishOld({ ...preview, name: "Obsolete" });
    await old;
    expect(state().preview).toBe(preview);
  });

  it("clear/exit cancels pending work and prevents a late error from restoring the draft", async () => {
    let fail!: (error: Error) => void;
    fetchRoute.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    );
    addPoints();
    const pending = state().calculate();
    state().reset();
    fail(new Error("Late failure"));
    await pending;
    expect(state()).toMatchObject({ waypoints: [], preview: null, error: null, isRouting: false });
  });

  it("preserves points after routing failure and supports retry", async () => {
    fetchRoute.mockRejectedValueOnce(new Error("No connection"));
    addPoints();
    await state().calculate();
    expect(state()).toMatchObject({
      waypoints: [first, second],
      error: "No connection",
      isRouting: false,
    });
    await state().calculate();
    expect(state()).toMatchObject({ preview, error: null });
  });

  it("keeps the preview on a failed save, then saves with the selected name on retry", async () => {
    saveParsedRoute
      .mockRejectedValueOnce(new Error("Disk full"))
      .mockResolvedValueOnce({ id: "saved" });
    addPoints();
    await state().calculate();
    expect(await state().save("Evening ride")).toBeNull();
    expect(state()).toMatchObject({ preview, error: "Disk full", isSaving: false });
    expect(await state().save("  Evening ride  ")).toEqual({ id: "saved" });
    expect(saveParsedRoute).toHaveBeenLastCalledWith(
      { ...preview, name: "Evening ride" },
      "planned-route.gpx",
    );
  });

  it("blocks duplicate saves and edits during persistence", async () => {
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
