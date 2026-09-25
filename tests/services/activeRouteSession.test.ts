import { describe, expect, it, vi } from "vitest";
import {
  restoreActiveRouteSession,
  refreshActiveRoutePosition,
} from "@/services/activeRouteSession";
import { buildRoutePoint } from "@/tests/fixtures/route";
import type { RoutePoint, UserPosition } from "@/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const position: UserPosition = {
  latitude: 48,
  longitude: 17,
  altitude: 180,
  heading: 90,
  speed: 5,
  timestamp: 1_000,
};

describe("active route restoration", () => {
  it.each(["routes", "collections"])(
    "waits for both metadata loads when %s finishes first, then loads only the current standalone route",
    async (first) => {
      const routes = deferred<void>();
      const collections = deferred<void>();
      let activeRouteId = "previous-route";
      const dependencies = {
        loadRouteMetadata: vi.fn(() => routes.promise),
        loadCollections: vi.fn(() => collections.promise),
        activeStandaloneRouteId: vi.fn(() => activeRouteId),
        loadRoutePoints: vi.fn().mockResolvedValue(undefined),
      };
      const restore = restoreActiveRouteSession(dependencies, () => true);
      expect(dependencies.loadRouteMetadata).toHaveBeenCalledOnce();
      expect(dependencies.loadCollections).toHaveBeenCalledOnce();
      const completedFirst = first === "routes" ? routes : collections;
      const completedLast = first === "routes" ? collections : routes;
      completedFirst.resolve();
      await completedFirst.promise;
      expect(dependencies.activeStandaloneRouteId).not.toHaveBeenCalled();
      expect(dependencies.loadRoutePoints).not.toHaveBeenCalled();

      activeRouteId = "restored-active-route";
      completedLast.resolve();
      await restore;
      expect(dependencies.loadRoutePoints).toHaveBeenCalledExactlyOnceWith(
        ["restored-active-route"],
        { prune: true },
      );
    },
  );

  it("does not request geometry if restoration is cancelled before metadata completes", async () => {
    const metadata = deferred<void>();
    let current = true;
    const dependencies = {
      loadRouteMetadata: () => metadata.promise,
      loadCollections: async () => {},
      activeStandaloneRouteId: vi.fn(() => "r1"),
      loadRoutePoints: vi.fn().mockResolvedValue(undefined),
    };
    const restore = restoreActiveRouteSession(dependencies, () => current);
    current = false;
    metadata.resolve();
    await restore;
    expect(dependencies.activeStandaloneRouteId).not.toHaveBeenCalled();
    expect(dependencies.loadRoutePoints).not.toHaveBeenCalled();
  });

  it("does not load standalone geometry when restored collection metadata selects a collection", async () => {
    let collectionActive = false;
    const dependencies = {
      loadRouteMetadata: async () => {},
      loadCollections: async () => {
        collectionActive = true;
      },
      // The caller resolves standalone identity from the two restored stores.
      activeStandaloneRouteId: vi.fn(() => (collectionActive ? null : "r1")),
      loadRoutePoints: vi.fn().mockResolvedValue(undefined),
    };
    await restoreActiveRouteSession(dependencies, () => true);
    expect(dependencies.activeStandaloneRouteId).toHaveReturnedWith(null);
    expect(dependencies.loadRoutePoints).not.toHaveBeenCalled();
  });

  it("propagates metadata failures without loading geometry from stale selection", async () => {
    const error = new Error("Route metadata unavailable");
    const dependencies = {
      loadRouteMetadata: async () => {
        throw error;
      },
      loadCollections: async () => {},
      activeStandaloneRouteId: vi.fn(() => "stale-route"),
      loadRoutePoints: vi.fn().mockResolvedValue(undefined),
    };
    await expect(restoreActiveRouteSession(dependencies, () => true)).rejects.toBe(error);
    expect(dependencies.activeStandaloneRouteId).not.toHaveBeenCalled();
    expect(dependencies.loadRoutePoints).not.toHaveBeenCalled();
  });
});

describe("active route GPS refresh", () => {
  it("snaps against the latest active context after the GPS request resolves", async () => {
    const gps = deferred<UserPosition | null>();
    let activeRoute = { id: "old-route", points: [buildRoutePoint(0, 0)] };
    const getActiveRoute = vi.fn(() => activeRoute);
    const applySnap = vi.fn();
    const refresh = refreshActiveRoutePosition(
      () => gps.promise,
      getActiveRoute,
      applySnap,
      () => true,
    );
    expect(getActiveRoute).not.toHaveBeenCalled();

    activeRoute = {
      id: "new-collection",
      points: [buildRoutePoint(0, 0), buildRoutePoint(2_000, 1)],
    };
    gps.resolve(position);
    await expect(refresh).resolves.toBe(position);
    expect(applySnap).toHaveBeenCalledExactlyOnceWith(position, activeRoute);
  });

  it("does not snap or publish a GPS fix after the session is cancelled", async () => {
    const gps = deferred<UserPosition | null>();
    let current = true;
    const getActiveRoute = vi.fn(() => ({ id: "r1", points: [buildRoutePoint(0, 0)] }));
    const applySnap = vi.fn();
    const refresh = refreshActiveRoutePosition(
      () => gps.promise,
      getActiveRoute,
      applySnap,
      () => current,
    );
    current = false;
    gps.resolve(position);
    await expect(refresh).resolves.toBeNull();
    expect(getActiveRoute).not.toHaveBeenCalled();
    expect(applySnap).not.toHaveBeenCalled();
  });

  it.each([null, { id: "empty-route", points: [] as RoutePoint[] }])(
    "returns the GPS fix when there is no usable active geometry: %j",
    async (activeRoute) => {
      const applySnap = vi.fn();
      await expect(
        refreshActiveRoutePosition(
          async () => position,
          () => activeRoute,
          applySnap,
          () => true,
        ),
      ).resolves.toBe(position);
      expect(applySnap).not.toHaveBeenCalled();
    },
  );

  it("does not resolve route geometry when GPS returns no fix", async () => {
    const getActiveRoute = vi.fn();
    const applySnap = vi.fn();
    await expect(
      refreshActiveRoutePosition(
        async () => null,
        getActiveRoute,
        applySnap,
        () => true,
      ),
    ).resolves.toBeNull();
    expect(getActiveRoute).not.toHaveBeenCalled();
    expect(applySnap).not.toHaveBeenCalled();
  });
});
