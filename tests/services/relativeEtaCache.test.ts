import { describe, expect, it, vi } from "vitest";
import { DEFAULT_POWER_CONFIG } from "@/constants";
import { databaseMocks } from "@/tests/mocks/database";
import { buildRoutePoint } from "@/tests/fixtures/route";
import {
  buildRelativeETACacheDescriptor,
  decodeCumulativeSeconds,
  encodeCumulativeSeconds,
  loadRelativeETACache,
  persistRelativeETACache,
} from "@/services/relativeEtaCache";

describe("relativeEtaCache", () => {
  it("encodes and decodes cumulative ETA as little-endian Float32 bytes", () => {
    const cumulative = [0, 1, 12.5, 9876.25];
    const bytes = encodeCumulativeSeconds(cumulative);

    expect(bytes.byteLength).toBe(cumulative.length * 4);
    expect(Array.from(bytes.slice(4, 8))).toEqual([0, 0, 128, 63]);
    expect(decodeCumulativeSeconds(bytes, cumulative.length)).toEqual(cumulative);
  });

  it("rejects cache blobs when point count does not match", () => {
    const bytes = encodeCumulativeSeconds([0, 10]);

    expect(decodeCumulativeSeconds(bytes, 3)).toBeNull();
  });

  it("rejects persisted rows with stale point counts", async () => {
    const input = {
      scope: "route" as const,
      scopeId: "r1",
      points: [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)],
      totalDistanceMeters: 1_000,
      totalAscentMeters: 10,
      totalDescentMeters: 5,
    };
    const descriptor = buildRelativeETACacheDescriptor(input, DEFAULT_POWER_CONFIG);
    databaseMocks.getRelativeETACache.mockResolvedValue({
      cacheKey: descriptor.cacheKey,
      scope: descriptor.scope,
      scopeId: descriptor.scopeId,
      signature: descriptor.signature,
      powerConfigKey: descriptor.powerConfigKey,
      algorithmVersion: descriptor.algorithmVersion,
      pointCount: 3,
      totalDurationSeconds: 10,
      cumulativeSeconds: encodeCumulativeSeconds([0, 10, 20]),
      updatedAt: "2026-01-01T00:00:00.000Z",
    });

    await expect(loadRelativeETACache(descriptor)).resolves.toBeNull();
  });

  it("treats cache read failures as misses", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = {
      scope: "route" as const,
      scopeId: "r1",
      points: [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)],
      totalDistanceMeters: 1_000,
      totalAscentMeters: 10,
      totalDescentMeters: 5,
    };
    const descriptor = buildRelativeETACacheDescriptor(input, DEFAULT_POWER_CONFIG);
    databaseMocks.getRelativeETACache.mockRejectedValue(new Error("no such table"));

    await expect(loadRelativeETACache(descriptor)).resolves.toBeNull();
    warn.mockRestore();
  });

  it("does not throw when cache persistence fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const input = {
      scope: "route" as const,
      scopeId: "r1",
      points: [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)],
      totalDistanceMeters: 1_000,
      totalAscentMeters: 10,
      totalDescentMeters: 5,
    };
    const descriptor = buildRelativeETACacheDescriptor(input, DEFAULT_POWER_CONFIG);
    databaseMocks.upsertRelativeETACache.mockRejectedValue(new Error("blob bind failed"));

    await expect(persistRelativeETACache(descriptor, [0, 100])).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
