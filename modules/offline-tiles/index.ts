import { requireNativeModule, EventEmitter, type EventSubscription } from "expo-modules-core";
import type { OfflineTileRegion } from "@/types";

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

export function setMapboxAccessToken(accessToken: string): void {
  OfflineTilesModule.setAccessToken?.(accessToken);
}

export function downloadTileRegion(
  id: string,
  styleURL: string,
  routeCoordinates: number[][],
  minZoom: number,
  maxZoom: number,
): Promise<void> {
  return OfflineTilesModule.downloadTileRegion(id, styleURL, routeCoordinates, minZoom, maxZoom);
}

export function cancelTileRegion(id: string): void {
  OfflineTilesModule.cancelTileRegion(id);
}

export function deleteTileRegion(id: string): Promise<void> {
  return OfflineTilesModule.deleteTileRegion(id);
}

export function getTileRegionSize(id: string): Promise<number> {
  return OfflineTilesModule.getTileRegionSize(id);
}

export function getAllTileRegions(styleURL: string): Promise<OfflineTileRegion[]> {
  return OfflineTilesModule.getAllTileRegions(styleURL);
}

export function addProgressListener(listener: (event: ProgressEvent) => void): EventSubscription {
  return emitter.addListener("onProgress", listener);
}
