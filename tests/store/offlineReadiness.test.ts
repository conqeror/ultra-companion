import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { offlineTilesMocks } from "@/tests/mocks/offlineTiles";
import { reactNativeMmkvMocks } from "@/tests/mocks/reactNativeMmkv";
import { useOfflineStore } from "@/store/offlineStore";
import type { OfflineRouteInfo, OfflineRoutePack } from "@/types";

const points = [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)];
const savedInfo: OfflineRouteInfo = {
  status: "complete",
  percentage: 100,
  downloadedBytes: 100,
  estimatedBytes: 200,
  downloadedAt: "2026-09-01T00:00:00.000Z",
  error: null,
};
const completePack: OfflineRoutePack = {
  routeId: "r1",
  totalBytes: 150,
  requiredResourceCount: 10,
  completedResourceCount: 10,
  stylePackComplete: true,
};

describe("offline map readiness", () => {
  beforeEach(() => {
    useOfflineStore.setState({ routeInfo: { r1: { ...savedInfo } } });
  });

  it.each(["complete", "downloading", "error"] as const)(
    "does not promote persisted %s state when tiles are only partially downloaded",
    async (status) => {
      useOfflineStore.setState({ routeInfo: { r1: { ...savedInfo, status } } });
      offlineTilesMocks.getAllRoutePacks.mockResolvedValue([
        { ...completePack, completedResourceCount: 4 },
      ]);
      await useOfflineStore.getState().refreshAllStatuses();
      expect(useOfflineStore.getState().getRouteInfo("r1")).toMatchObject({
        status: "error",
        percentage: 40,
        downloadedBytes: 150,
        estimatedBytes: 200,
        downloadedAt: null,
      });
      expect(useOfflineStore.getState().isRouteOfflineReady("r1")).toBe(false);
    },
  );

  it.each([
    { ...completePack, requiredResourceCount: 0, completedResourceCount: 0 },
    { ...completePack, stylePackComplete: false },
  ])("requires known tile resources and a complete retained style pack", async (pack) => {
    offlineTilesMocks.getAllRoutePacks.mockResolvedValue([pack]);
    await useOfflineStore.getState().refreshAllStatuses();
    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("error");
    expect(useOfflineStore.getState().isRouteOfflineReady("r1")).toBe(false);
  });

  it("recovers native complete packs and clears stale failure information", async () => {
    useOfflineStore.setState({
      routeInfo: { r1: { ...savedInfo, status: "error", error: "Interrupted" } },
    });
    offlineTilesMocks.getAllRoutePacks.mockResolvedValue([
      completePack,
      { ...completePack, routeId: "recovered" },
    ]);
    await useOfflineStore.getState().refreshAllStatuses();
    expect(useOfflineStore.getState().getRouteInfo("r1")).toMatchObject({
      status: "complete",
      percentage: 100,
      downloadedBytes: 150,
      error: null,
      readinessVersion: 1,
      downloadedAt: savedInfo.downloadedAt,
    });
    expect(useOfflineStore.getState().isRouteOfflineReady("recovered")).toBe(true);
  });

  it("preserves all stored state when the native inventory cannot be read", async () => {
    const previous = useOfflineStore.getState().routeInfo;
    offlineTilesMocks.getAllRoutePacks.mockRejectedValue(new Error("Tile store unavailable"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    await useOfflineStore.getState().refreshAllStatuses();
    expect(useOfflineStore.getState().routeInfo).toBe(previous);
    expect(reactNativeMmkvMocks.set).not.toHaveBeenCalled();
    warning.mockRestore();
  });

  it("removes stale state only after a successful empty inventory", async () => {
    await useOfflineStore.getState().refreshAllStatuses();
    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("idle");
  });

  it("does not delete an active download that has not created its native region yet", async () => {
    let finish!: () => void;
    offlineTilesMocks.downloadRouteTiles.mockImplementation(
      (_routeId, _points, onProgress, onComplete) =>
        new Promise<void>((resolve) => {
          onProgress(40, 40);
          finish = () => {
            onProgress(100, 500);
            onComplete(500);
            resolve();
          };
        }),
    );
    const download = useOfflineStore.getState().startTileDownload("r1", points);
    await useOfflineStore.getState().refreshAllStatuses();
    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("downloading");
    finish();
    await download;
    // Completion bytes must survive the 500ms progress throttle.
    expect(useOfflineStore.getState().getRouteInfo("r1").downloadedBytes).toBe(500);
  });

  it("does not resurrect cancelled data from an inventory already in flight", async () => {
    let resolveInventory!: (packs: OfflineRoutePack[]) => void;
    offlineTilesMocks.getAllRoutePacks.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInventory = resolve;
        }),
    );
    const refresh = useOfflineStore.getState().refreshAllStatuses();
    await useOfflineStore.getState().cancelDownload("r1");
    resolveInventory([completePack]);
    await refresh;
    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("idle");
  });

  it("does not replace a newly completed download with an older empty inventory", async () => {
    let resolveInventory!: (packs: OfflineRoutePack[]) => void;
    offlineTilesMocks.getAllRoutePacks.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveInventory = resolve;
        }),
    );
    const refresh = useOfflineStore.getState().refreshAllStatuses();
    await useOfflineStore.getState().startTileDownload("r1", points);
    resolveInventory([]);
    await refresh;
    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("complete");
  });

  it("requires verification of legacy completions and makes interrupted downloads retryable on restart", async () => {
    reactNativeMmkvMocks.getString.mockReturnValue(
      JSON.stringify({
        legacy: savedInfo,
        interrupted: { ...savedInfo, status: "downloading" },
        verified: { ...savedInfo, readinessVersion: 1 },
      }),
    );
    vi.resetModules();
    const { useOfflineStore: restored } = await import("@/store/offlineStore");
    expect(restored.getState().getRouteInfo("legacy").status).toBe("error");
    expect(restored.getState().getRouteInfo("legacy").downloadedBytes).toBe(100);
    expect(restored.getState().getRouteInfo("interrupted").status).toBe("error");
    expect(restored.getState().isRouteOfflineReady("verified")).toBe(true);
  });
});
