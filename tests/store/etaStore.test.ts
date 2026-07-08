import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { databaseMocks } from "@/tests/mocks/database";
import { buildRoutePoint } from "@/tests/fixtures/route";
import type { RoutePoint } from "@/types";

vi.mock("@/store/routeStore", () => ({
  useRouteStore: {
    getState: () => ({
      snappedPosition: null,
      visibleRoutePoints: {},
    }),
  },
}));

vi.mock("@/store/collectionStore", () => ({
  useCollectionStore: {
    getState: () => ({
      activeStitchedCollection: null,
      collections: [],
    }),
  },
}));

vi.mock("@/store/poiStore", () => ({
  usePoiStore: {
    getState: () => ({
      pois: {},
    }),
  },
}));

import { useEtaStore } from "@/store/etaStore";
import {
  buildRelativeETACacheDescriptor,
  encodeCumulativeSeconds,
  type RelativeETAInput,
} from "@/services/relativeEtaCache";

const points = [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1), buildRoutePoint(2_000, 2)];

function inputFor(routeId: string, pts: RoutePoint[] = points): RelativeETAInput {
  return {
    scope: "route",
    scopeId: routeId,
    points: pts,
    totalDistanceMeters: pts[pts.length - 1]?.distanceFromStartMeters ?? 0,
    totalAscentMeters: 10,
    totalDescentMeters: 5,
  };
}

function resetEtaStore() {
  useEtaStore.setState({
    powerConfig: DEFAULT_POWER_CONFIG,
    cumulativeTime: null,
    routeId: null,
    cachedPoints: null,
    activeCacheKey: null,
    etaStatus: "idle",
    etaProgress: null,
    etaError: null,
    cacheStates: {},
  });
}

describe("etaStore relative ETA cache", () => {
  beforeEach(() => {
    resetEtaStore();
  });

  it("loads a cache hit without recomputing", async () => {
    const input = inputFor("r1");
    const descriptor = buildRelativeETACacheDescriptor(input, DEFAULT_POWER_CONFIG);
    databaseMocks.getRelativeETACache.mockResolvedValue({
      cacheKey: descriptor.cacheKey,
      scope: descriptor.scope,
      scopeId: descriptor.scopeId,
      signature: descriptor.signature,
      powerConfigKey: descriptor.powerConfigKey,
      algorithmVersion: descriptor.algorithmVersion,
      pointCount: descriptor.pointCount,
      totalDurationSeconds: 200,
      cumulativeSeconds: encodeCumulativeSeconds([0, 100, 200]),
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(useEtaStore.getState().ensureRelativeETA(input)).resolves.toEqual([0, 100, 200]);

    expect(databaseMocks.upsertRelativeETACache).not.toHaveBeenCalled();
    expect(useEtaStore.getState()).toMatchObject({
      routeId: "r1",
      etaStatus: "ready",
      cumulativeTime: [0, 100, 200],
    });
  });

  it("computes, persists, and publishes ETA on cache miss", async () => {
    const input = inputFor("r1");

    await expect(useEtaStore.getState().ensureRelativeETA(input)).resolves.toEqual(
      expect.arrayContaining([0]),
    );

    expect(databaseMocks.upsertRelativeETACache).toHaveBeenCalledOnce();
    expect(useEtaStore.getState().etaStatus).toBe("ready");
    expect(useEtaStore.getState().cumulativeTime).toHaveLength(points.length);
  });

  it("computes and publishes ETA when cache read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = inputFor("r1");
    databaseMocks.getRelativeETACache.mockRejectedValue(new Error("no such table"));

    await expect(useEtaStore.getState().ensureRelativeETA(input)).resolves.toHaveLength(
      points.length,
    );

    expect(databaseMocks.upsertRelativeETACache).toHaveBeenCalledOnce();
    expect(useEtaStore.getState()).toMatchObject({
      routeId: "r1",
      etaStatus: "ready",
    });
    expect(useEtaStore.getState().cumulativeTime).toHaveLength(points.length);
    warn.mockRestore();
  });

  it("publishes computed ETA when cache persistence fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = inputFor("r1");
    databaseMocks.upsertRelativeETACache.mockRejectedValue(new Error("blob bind failed"));

    await expect(useEtaStore.getState().ensureRelativeETA(input)).resolves.toHaveLength(
      points.length,
    );

    expect(useEtaStore.getState()).toMatchObject({
      routeId: "r1",
      etaStatus: "ready",
    });
    expect(useEtaStore.getState().cumulativeTime).toHaveLength(points.length);
    warn.mockRestore();
  });

  it("shares duplicate ensure calls for the same cache key", async () => {
    const input = inputFor("r1");

    const first = useEtaStore.getState().ensureRelativeETA(input);
    const second = useEtaStore.getState().ensureRelativeETA(input);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(databaseMocks.upsertRelativeETACache).toHaveBeenCalledOnce();
  });

  it("ignores stale computation results after route switch", async () => {
    const r1Input = inputFor("r1");
    const r2Input = inputFor("r2");
    const r1Descriptor = buildRelativeETACacheDescriptor(r1Input, DEFAULT_POWER_CONFIG);
    const r2Descriptor = buildRelativeETACacheDescriptor(r2Input, DEFAULT_POWER_CONFIG);
    const resolvers = new Map<string, () => void>();
    databaseMocks.getRelativeETACache.mockImplementation(
      async (cacheKey: string) =>
        new Promise((resolve) => {
          const descriptor = cacheKey === r1Descriptor.cacheKey ? r1Descriptor : r2Descriptor;
          const cumulative = cacheKey === r1Descriptor.cacheKey ? [0, 111, 222] : [0, 200, 400];
          resolvers.set(cacheKey, () =>
            resolve({
              cacheKey: descriptor.cacheKey,
              scope: descriptor.scope,
              scopeId: descriptor.scopeId,
              signature: descriptor.signature,
              powerConfigKey: descriptor.powerConfigKey,
              algorithmVersion: descriptor.algorithmVersion,
              pointCount: descriptor.pointCount,
              totalDurationSeconds: cumulative[cumulative.length - 1],
              cumulativeSeconds: encodeCumulativeSeconds(cumulative),
              updatedAt: "2026-01-01T00:00:00.000Z",
            }),
          );
        }),
    );

    const first = useEtaStore.getState().ensureRelativeETA(r1Input);
    await Promise.resolve();
    const second = useEtaStore.getState().ensureRelativeETA(r2Input);
    await Promise.resolve();

    resolvers.get(r1Descriptor.cacheKey)?.();
    await first;

    expect(useEtaStore.getState().routeId).toBe("r2");
    expect(useEtaStore.getState().cumulativeTime).toBeNull();

    resolvers.get(r2Descriptor.cacheKey)?.();
    await second;

    expect(useEtaStore.getState()).toMatchObject({
      routeId: "r2",
      cumulativeTime: [0, 200, 400],
      etaStatus: "ready",
    });
  });

  it("uses a different cache key when power config changes", async () => {
    const input = inputFor("r1");

    await useEtaStore.getState().ensureRelativeETA(input);
    useEtaStore.getState().updatePowerConfig({ powerWatts: DEFAULT_POWER_CONFIG.powerWatts + 20 });
    await useEtaStore.getState().ensureRelativeETA(input);

    const first = databaseMocks.upsertRelativeETACache.mock.calls[0][0].cacheKey;
    const second = databaseMocks.upsertRelativeETACache.mock.calls[1][0].cacheKey;
    expect(first).not.toBe(second);
  });
});
