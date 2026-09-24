import { describe, expect, it, vi } from "vitest";
import { buildRouteDetailPresentation, startRouteDetailLoad } from "@/services/routeDetailModel";
import type { FerryCrossing, RouteDetailLoadState, RouteWithPoints } from "@/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function route(id = "r1"): RouteWithPoints {
  return {
    id,
    name: id,
    fileName: `${id}.gpx`,
    color: "#E63946",
    isActive: false,
    isVisible: true,
    totalDistanceMeters: 4_000,
    totalAscentMeters: 1_100,
    totalDescentMeters: 950,
    pointCount: 5,
    createdAt: "2026-09-01T00:00:00.000Z",
    points: [100, 200, 1_200, 300, 250].map((elevationMeters, idx) => ({
      latitude: 0,
      longitude: idx,
      elevationMeters,
      distanceFromStartMeters: idx * 1_000,
      idx,
    })),
  };
}

const ferry: FerryCrossing = {
  id: "f1",
  routeId: "r1",
  name: "Ferry",
  startDistanceMeters: 1_000,
  endDistanceMeters: 3_000,
  startLatitude: 0,
  startLongitude: 1,
  endLatitude: 0,
  endLongitude: 3,
  durationMinutes: 30,
  assumedWaitMinutes: 10,
  boardingBufferMinutes: 5,
  source: "manual",
  sourceId: null,
  sourceUrl: null,
  operator: null,
  timetableUrl: null,
  bicycleAccess: "yes",
  providerRefs: {},
  tags: {},
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("route detail loading", () => {
  it("waits for ferry data before publishing the route overview", async () => {
    const ferries = deferred<void>();
    const onChange = vi.fn<(state: RouteDetailLoadState) => void>();
    const detail = route();
    startRouteDetailLoad(
      "r1",
      async () => detail,
      () => ferries.promise,
      onChange,
    );
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      routeId: "r1",
      route: null,
      loading: true,
      error: null,
    });
    ferries.resolve();
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        routeId: "r1",
        route: detail,
        loading: false,
        error: null,
      }),
    );
  });

  it("ignores an old route that finishes after navigating to a new route", async () => {
    const oldRequest = deferred<RouteWithPoints>();
    const newRequest = deferred<RouteWithPoints>();
    const loadRoute = (id: string) => (id === "old" ? oldRequest.promise : newRequest.promise);
    const onChange = vi.fn<(state: RouteDetailLoadState) => void>();
    const cancelOld = startRouteDetailLoad("old", loadRoute, async () => {}, onChange);
    cancelOld();
    startRouteDetailLoad("new", loadRoute, async () => {}, onChange);
    const latest = route("new");
    newRequest.resolve(latest);
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith({
        routeId: "new",
        route: latest,
        loading: false,
        error: null,
      }),
    );
    const callsAfterNewLoad = onChange.mock.calls.length;
    oldRequest.resolve(route("old"));
    await oldRequest.promise;
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(callsAfterNewLoad);
  });

  it("does not publish a late loading failure after the screen closes", async () => {
    const request = deferred<RouteWithPoints>();
    const onChange = vi.fn<(state: RouteDetailLoadState) => void>();
    const cancel = startRouteDetailLoad(
      "r1",
      () => request.promise,
      async () => {},
      onChange,
    );
    cancel();
    request.reject(new Error("Database unavailable"));
    await request.promise.catch(() => {});
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledOnce();
  });

  it.each(["route", "ferries"])(
    "reports a %s load failure and allows a clean retry",
    async (source) => {
      const onChange = vi.fn<(state: RouteDetailLoadState) => void>();
      const failure = new Error("Database unavailable");
      const loadRoute = vi.fn(async () => route());
      const loadFerries = vi.fn(async () => {});
      if (source === "route") loadRoute.mockRejectedValueOnce(failure);
      else loadFerries.mockRejectedValueOnce(failure);
      const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
      const cancel = startRouteDetailLoad("r1", loadRoute, loadFerries, onChange);
      await vi.waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith({
          routeId: "r1",
          route: null,
          loading: false,
          error: "Could not load route data. Please try again.",
        }),
      );
      cancel();
      startRouteDetailLoad("r1", loadRoute, loadFerries, onChange);
      await vi.waitFor(() =>
        expect(onChange).toHaveBeenLastCalledWith({
          routeId: "r1",
          route: route(),
          loading: false,
          error: null,
        }),
      );
      warning.mockRestore();
    },
  );

  it("finishes missing route IDs without starting a request", () => {
    const loadRoute = vi.fn();
    const loadFerries = vi.fn();
    const onChange = vi.fn();
    startRouteDetailLoad(null, loadRoute, loadFerries, onChange);
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      routeId: null,
      route: null,
      loading: false,
      error: null,
    });
    expect(loadRoute).not.toHaveBeenCalled();
    expect(loadFerries).not.toHaveBeenCalled();
  });
});

describe("shared route detail presentation", () => {
  it("uses the same ferry exclusions for route statistics and preview geometry", () => {
    const detail = route();
    const presentation = buildRouteDetailPresentation(detail, [ferry]);
    expect(presentation.ridingStats).toEqual({ distance: 2_000, ascent: 100, descent: 50 });
    expect(presentation.displayFerries[0]).toMatchObject({
      id: ferry.id,
      effectiveStartDistanceMeters: 1_000,
      effectiveEndDistanceMeters: 3_000,
    });
    expect(
      presentation.previewLayers.map((layer) =>
        layer.points.map((point) => point.distanceFromStartMeters),
      ),
    ).toEqual([
      [0, 1_000],
      [3_000, 4_000],
    ]);
    expect(detail.points[2].distanceFromStartMeters).toBe(2_000);
    expect(detail.totalDistanceMeters).toBe(4_000);
  });

  it("recomputes the shared summary and preview after a ferry is removed", () => {
    const detail = route();
    const withFerry = buildRouteDetailPresentation(detail, [ferry]);
    const withoutFerry = buildRouteDetailPresentation(detail, []);
    expect(withFerry.ridingStats?.distance).toBe(2_000);
    expect(withoutFerry.ridingStats).toEqual({ distance: 4_000, ascent: 1_100, descent: 950 });
    expect(withoutFerry.displayFerries).toEqual([]);
    expect(withoutFerry.previewLayers).toHaveLength(1);
    expect(withoutFerry.previewLayers[0].points).toBe(detail.points);
  });

  it("does not retain another route's overview while route data is unavailable", () => {
    expect(buildRouteDetailPresentation(null, [ferry])).toEqual({
      displayFerries: [],
      previewLayers: [],
      ridingStats: null,
    });
  });
});
