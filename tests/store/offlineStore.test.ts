import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { databaseMocks } from "@/tests/mocks/database";
import { offlineTilesMocks } from "@/tests/mocks/offlineTiles";

const mocks = vi.hoisted(() => ({
  fetchSource: vi.fn(),
  discoveryCategories: ["gas_station", "water"],
}));

vi.mock("@/store/poiStore", () => ({
  usePoiStore: {
    getState: () => ({
      fetchSource: mocks.fetchSource,
      discoveryCategories: mocks.discoveryCategories,
    }),
  },
}));

import { useOfflineStore } from "@/store/offlineStore";

const points = [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)];

describe("offlineStore offline preparation", () => {
  beforeEach(() => {
    useOfflineStore.setState({ routeInfo: {}, isConnected: true });
    mocks.fetchSource.mockResolvedValue(undefined);
    mocks.discoveryCategories = ["gas_station", "water"];
    offlineTilesMocks.estimateDownloadSize.mockReturnValue(1234);
  });

  it("downloads map tiles without fetching POI sources", async () => {
    offlineTilesMocks.downloadRouteTiles.mockImplementation(
      async (_routeId, _points, onProgress, onComplete) => {
        onProgress(50, 512);
        onComplete();
      },
    );

    await useOfflineStore.getState().startTileDownload("r1", points);

    expect(databaseMocks.getPOICountsBySource).not.toHaveBeenCalled();
    expect(mocks.fetchSource).not.toHaveBeenCalled();
    expect(offlineTilesMocks.downloadRouteTiles).toHaveBeenCalledOnce();
    expect(useOfflineStore.getState().getRouteInfo("r1")).toMatchObject({
      status: "complete",
      percentage: 100,
      downloadedBytes: 512,
      estimatedBytes: 1234,
      error: null,
    });
  });

  it("prepares missing POI sources independently before starting missing tiles", async () => {
    databaseMocks.getPOICountsBySource.mockResolvedValue({ google: 0, osm: 0 });
    mocks.fetchSource.mockImplementation(async (_routeId, source) => {
      if (source === "google") throw new Error("Google Places API error (503)");
    });
    offlineTilesMocks.downloadRouteTiles.mockImplementation(
      async (_routeId, _points, _onProgress, onComplete) => {
        onComplete();
      },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await useOfflineStore.getState().prepareRouteOffline("r1", points);

    expect(mocks.fetchSource.mock.calls.map(([, source]) => source)).toEqual(["google", "osm"]);
    expect(offlineTilesMocks.downloadRouteTiles).toHaveBeenCalledOnce();
    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("complete");
    warn.mockRestore();
  });

  it("does not restart a tile download that starts while POIs are fetching", async () => {
    let resolveDownload: (() => void) | undefined;
    let tileDownload: Promise<void> | undefined;
    offlineTilesMocks.downloadRouteTiles.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveDownload = resolve;
        }),
    );
    mocks.fetchSource.mockImplementation(async (_routeId, source) => {
      if (source === "google") {
        tileDownload = useOfflineStore.getState().startTileDownload("r1", points);
      }
    });

    await useOfflineStore.getState().prepareRouteOffline("r1", points);

    expect(mocks.fetchSource.mock.calls.map(([, source]) => source)).toEqual(["google", "osm"]);
    expect(offlineTilesMocks.downloadRouteTiles).toHaveBeenCalledOnce();

    resolveDownload?.();
    await tileDownload;
  });

  it("skips disabled POI sources while preparing offline data", async () => {
    mocks.discoveryCategories = ["water"];
    databaseMocks.getPOICountsBySource.mockResolvedValue({ google: 0, osm: 0 });
    offlineTilesMocks.downloadRouteTiles.mockImplementation(
      async (_routeId, _points, _onProgress, onComplete) => {
        onComplete();
      },
    );

    await useOfflineStore.getState().prepareRouteOffline("r1", points);

    expect(mocks.fetchSource.mock.calls.map(([, source]) => source)).toEqual(["osm"]);
    expect(offlineTilesMocks.downloadRouteTiles).toHaveBeenCalledOnce();
  });

  it("cancel resets visible tile state and ignores late native errors", async () => {
    let rejectDownload: ((error: string) => void) | undefined;
    let resolveDownload: (() => void) | undefined;
    offlineTilesMocks.downloadRouteTiles.mockImplementation(
      (_routeId, _points, _onProgress, _onComplete, onError) =>
        new Promise<void>((resolve) => {
          rejectDownload = onError;
          resolveDownload = resolve;
        }),
    );

    const download = useOfflineStore.getState().startTileDownload("r1", points);

    expect(useOfflineStore.getState().getRouteInfo("r1").status).toBe("downloading");

    await useOfflineStore.getState().cancelDownload("r1");
    expect(rejectDownload).toBeDefined();
    expect(resolveDownload).toBeDefined();
    rejectDownload?.("Download cancelled");
    resolveDownload?.();
    await download;

    expect(useOfflineStore.getState().getRouteInfo("r1")).toMatchObject({
      status: "idle",
      percentage: 0,
      error: null,
    });
  });
});
