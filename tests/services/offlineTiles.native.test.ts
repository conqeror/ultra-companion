import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildRoutePoint } from "@/tests/fixtures/route";
import { MAP_STYLE_URL, type OfflineTileRegion } from "@/types";
import { TILE_DOWNLOAD_STALL_MS } from "@/constants";
import lightStyle from "@/assets/map-styles/outdoors-v12.json";
import darkStyle from "@/assets/map-styles/outdoors-v12-dark.json";

const native = vi.hoisted(() => ({
  downloadTileRegion: vi.fn(),
  cancelTileRegion: vi.fn(),
  deleteTileRegion: vi.fn(),
  getAllTileRegions: vi.fn(),
  addProgressListener: vi.fn(),
  setMapboxAccessToken: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("@/modules/offline-tiles", () => native);

import {
  deleteRoutePacks,
  downloadRouteTiles,
  getAllRoutePacks,
} from "@/services/offlineTiles.native";

const points = [buildRoutePoint(0, 0), buildRoutePoint(1_000, 1)];
const region: OfflineTileRegion = {
  id: "ultra-route-r1",
  completedBytes: 1_000,
  requiredResourceCount: 10,
  completedResourceCount: 10,
  stylePackRequiredResourceCount: 5,
  stylePackCompletedResourceCount: 5,
};

function fonts(style: typeof lightStyle) {
  return new Set(style.layers.flatMap((layer) => layer.layout?.["text-font"] ?? []));
}

describe("native offline tile verification", () => {
  beforeEach(() => {
    native.downloadTileRegion.mockResolvedValue(undefined);
    native.deleteTileRegion.mockResolvedValue(undefined);
    native.getAllTileRegions.mockResolvedValue([region]);
    native.addProgressListener.mockReturnValue({ remove: native.removeListener });
  });

  it("returns actual resource counts and checks the configured retained style", async () => {
    expect(await getAllRoutePacks()).toEqual([
      {
        routeId: "r1",
        totalBytes: 1_000,
        requiredResourceCount: 10,
        completedResourceCount: 10,
        stylePackComplete: true,
      },
    ]);
    expect(native.getAllTileRegions).toHaveBeenCalledWith(MAP_STYLE_URL);
  });

  it.each([
    { ...region, stylePackRequiredResourceCount: 0, stylePackCompletedResourceCount: 0 },
    { ...region, stylePackCompletedResourceCount: 4 },
  ])("does not treat absent or incomplete styles as retained", async (partial) => {
    native.getAllTileRegions.mockResolvedValue([partial]);
    expect((await getAllRoutePacks())[0].stylePackComplete).toBe(false);
  });

  it("propagates enumeration failures instead of reporting an empty inventory", async () => {
    native.getAllTileRegions.mockRejectedValue(new Error("Cannot read style packs"));
    await expect(getAllRoutePacks()).rejects.toThrow("Cannot read style packs");
  });

  it.each([
    { ...region, completedResourceCount: 4 },
    { ...region, requiredResourceCount: 0, completedResourceCount: 0 },
    { ...region, stylePackCompletedResourceCount: 0 },
  ])(
    "verifies resources before publishing completion even when native loading resolves",
    async (partial) => {
      native.getAllTileRegions.mockResolvedValue([partial]);
      const onComplete = vi.fn();
      const onError = vi.fn();
      await downloadRouteTiles("r1", points, vi.fn(), onComplete, onError);
      expect(onComplete).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledWith(expect.stringContaining("incomplete"));
      expect(native.removeListener).toHaveBeenCalledOnce();
    },
  );

  it("reports final verified bytes and releases its progress listener", async () => {
    const onComplete = vi.fn();
    const onProgress = vi.fn();
    const onError = vi.fn();
    await downloadRouteTiles("r1", points, onProgress, onComplete, onError);
    expect(onComplete).toHaveBeenCalledWith(1_000);
    expect(onProgress).toHaveBeenLastCalledWith(100, 1_000);
    expect(onError).not.toHaveBeenCalled();
    expect(native.removeListener).toHaveBeenCalledOnce();
  });

  it("does not start native work when cancelled during stale-region cleanup", async () => {
    let finishCleanup!: () => void;
    native.deleteTileRegion.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finishCleanup = resolve;
        }),
    );
    const onComplete = vi.fn();
    const download = downloadRouteTiles("r1", points, vi.fn(), onComplete, vi.fn());
    await deleteRoutePacks("r1");
    finishCleanup();
    await download;
    expect(native.downloadTileRegion).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(native.addProgressListener).not.toHaveBeenCalled();
  });

  it("keeps deletion failures visible to the store", async () => {
    native.deleteTileRegion.mockRejectedValueOnce(new Error("Could not remove region"));
    await expect(deleteRoutePacks("r1")).rejects.toThrow("Could not remove region");
  });

  it("does not let a cancelled attempt's stall timer cancel its replacement", async () => {
    vi.useFakeTimers();
    try {
      let finishOld!: () => void;
      let finishNew!: () => void;
      native.downloadTileRegion
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishOld = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              finishNew = resolve;
            }),
        );
      const oldComplete = vi.fn();
      const oldDownload = downloadRouteTiles("r1", points, vi.fn(), oldComplete, vi.fn());
      await Promise.resolve();
      await deleteRoutePacks("r1");
      await vi.advanceTimersByTimeAsync(1_000);
      const newComplete = vi.fn();
      const newDownload = downloadRouteTiles("r1", points, vi.fn(), newComplete, vi.fn());
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(TILE_DOWNLOAD_STALL_MS - 1_000);
      expect(native.cancelTileRegion).not.toHaveBeenCalled();
      finishOld();
      finishNew();
      await Promise.all([oldDownload, newDownload]);
      expect(oldComplete).not.toHaveBeenCalled();
      expect(newComplete).toHaveBeenCalledWith(1_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps both bundled styles on the same retained outdoors resources", () => {
    expect(MAP_STYLE_URL).toBe("mapbox://styles/mapbox/outdoors-v12");
    expect(lightStyle.sprite).toBe("mapbox://sprites/mapbox/outdoors-v12");
    expect(darkStyle.sprite).toBe(lightStyle.sprite);
    expect(darkStyle.glyphs).toBe(lightStyle.glyphs);
    expect(darkStyle.sources).toEqual(lightStyle.sources);
    expect(fonts(darkStyle)).toEqual(fonts(lightStyle));
  });
});
