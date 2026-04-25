import { vi } from "vitest";
import type {
  deleteRoutePacks,
  downloadRouteTiles,
  estimateDownloadSize,
  getAllRoutePacks,
} from "@/services/offlineTiles";

export const offlineTilesMocks = {
  deleteRoutePacks: vi.fn<typeof deleteRoutePacks>(),
  downloadRouteTiles: vi.fn<typeof downloadRouteTiles>(),
  estimateDownloadSize: vi.fn<typeof estimateDownloadSize>(),
  getAllRoutePacks: vi.fn<typeof getAllRoutePacks>(),
};

export function resetOfflineTilesMocks(): void {
  offlineTilesMocks.deleteRoutePacks.mockResolvedValue(undefined);
  offlineTilesMocks.downloadRouteTiles.mockImplementation(
    async (_routeId, _points, _onProgress, onComplete) => {
      onComplete();
    },
  );
  offlineTilesMocks.estimateDownloadSize.mockReturnValue(0);
  offlineTilesMocks.getAllRoutePacks.mockResolvedValue([]);
}
