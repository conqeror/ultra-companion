import { requireNativeModule, EventEmitter, type EventSubscription } from "expo-modules-core";

interface ProgressEvent {
  id: string;
  percentage: number;
  completedBytes: number;
}

type OfflineTilesEvents = {
  onProgress: (event: ProgressEvent) => void;
};

const OfflineTilesModule = requireNativeModule("OfflineTiles");
const emitter = new EventEmitter<OfflineTilesEvents>(OfflineTilesModule);

export function downloadTileRegion(
  id: string,
  styleURL: string,
  routeCoordinates: number[][],
  minZoom: number,
  maxZoom: number,
): Promise<void> {
  return OfflineTilesModule.downloadTileRegion(id, styleURL, routeCoordinates, minZoom, maxZoom);
}

export function deleteTileRegion(id: string): Promise<void> {
  return OfflineTilesModule.deleteTileRegion(id);
}

export function getTileRegionSize(id: string): Promise<number> {
  return OfflineTilesModule.getTileRegionSize(id);
}

export function getAllTileRegions(): Promise<Array<{ id: string; completedBytes: number }>> {
  return OfflineTilesModule.getAllTileRegions();
}

export function addProgressListener(listener: (event: ProgressEvent) => void): EventSubscription {
  return emitter.addListener("onProgress", listener);
}
