import React, { useEffect, useMemo, useState, useCallback } from "react";
import { View, TouchableOpacity, Alert } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useOfflineStore } from "@/store/offlineStore";
import { usePoiStore, type SourceInfo } from "@/store/poiStore";
import type { POIFetchedSource, StitchedCollection } from "@/types";
import { formatFileSize } from "@/utils/formatters";
import { estimateDownloadSize } from "@/services/offlineTiles";
import { getStitchedSourceRouteIds } from "@/services/stitchingService";
import { getRoutePoints } from "@/db/database";

interface CollectionOfflineSectionProps {
  stitched: StitchedCollection;
}

function isSourceReady(info: SourceInfo | undefined): boolean {
  return info?.status === "done" || (info?.count ?? 0) > 0;
}

function sourceLabel(source: POIFetchedSource): string {
  return source === "google" ? "Google Places" : "OpenStreetMap";
}

export default function CollectionOfflineSection({ stitched }: CollectionOfflineSectionProps) {
  const isConnected = useOfflineStore((s) => s.isConnected);
  const prepareRouteOffline = useOfflineStore((s) => s.prepareRouteOffline);
  const deleteOfflineData = useOfflineStore((s) => s.deleteOfflineData);
  const routeInfo = useOfflineStore((s) => s.routeInfo);
  const allPois = usePoiStore((s) => s.pois);
  const allSourceInfo = usePoiStore((s) => s.sourceInfo);
  const loadPOIs = usePoiStore((s) => s.loadPOIs);

  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const segments = stitched.segments;
  const sourceRouteIds = useMemo(() => getStitchedSourceRouteIds(segments), [segments]);
  const routeNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const span of stitched.sourceSpans) {
      names[span.routeId] = span.routeName;
    }
    return names;
  }, [stitched.sourceSpans]);
  const segmentRouteIdsKey = useMemo(() => sourceRouteIds.join("\n"), [sourceRouteIds]);

  useEffect(() => {
    if (!segmentRouteIdsKey) return;
    for (const routeId of segmentRouteIdsKey.split("\n")) {
      loadPOIs(routeId);
    }
  }, [segmentRouteIdsKey, loadPOIs]);

  const stats = useMemo(() => {
    let readyCount = 0;
    let downloadedBytes = 0;
    let estimatedBytes = 0;
    let totalPOIs = 0;
    let anyDownloading = false;
    let anySourceFetching = false;
    let poiReadyCount = 0;
    let offlineReadyCount = 0;

    for (const routeId of sourceRouteIds) {
      const info = routeInfo[routeId];
      const sources = allSourceInfo[routeId];
      const poiReady = isSourceReady(sources?.osm) && isSourceReady(sources?.google);
      if (info?.status === "complete") {
        readyCount++;
        downloadedBytes += info.downloadedBytes;
      }
      if (info?.status === "downloading") anyDownloading = true;
      if (sources?.osm?.status === "fetching" || sources?.google?.status === "fetching") {
        anySourceFetching = true;
      }
      if (poiReady) poiReadyCount++;
      if (info?.status === "complete" && poiReady) offlineReadyCount++;
      totalPOIs += allPois[routeId]?.length ?? 0;
    }

    // Estimate from stitched points (rough)
    estimatedBytes = estimateDownloadSize(stitched.points);

    return {
      readyCount,
      total: sourceRouteIds.length,
      downloadedBytes,
      estimatedBytes,
      totalPOIs,
      anyDownloading,
      anySourceFetching,
      poiReadyCount,
      offlineReadyCount,
    };
  }, [sourceRouteIds, routeInfo, allPois, allSourceInfo, stitched.points]);

  const allTilesReady = stats.readyCount === stats.total && stats.total > 0;
  const allOfflineReady = stats.offlineReadyCount === stats.total && stats.total > 0;

  const poiErrors = useMemo(() => {
    const out: { routeName: string; source: POIFetchedSource; error: string }[] = [];
    for (const routeId of sourceRouteIds) {
      const src = allSourceInfo[routeId];
      const routeName = routeNameById[routeId] ?? "segment";
      if (src?.osm?.error) out.push({ routeName, source: "osm", error: src.osm.error });
      if (src?.google?.error) out.push({ routeName, source: "google", error: src.google.error });
    }
    return out;
  }, [sourceRouteIds, routeNameById, allSourceInfo]);

  // Pick the first actively-fetching source across segments. Only one runs at
  // a time (prepareRouteOffline serializes), so this is the progress we show.
  const activePoiFetch = useMemo(() => {
    for (const routeId of sourceRouteIds) {
      const src = allSourceInfo[routeId];
      const routeName = routeNameById[routeId] ?? "segment";
      if (src?.google?.status === "fetching") {
        return {
          routeName,
          source: "google" as const,
          progress: src.google.progress,
        };
      }
      if (src?.osm?.status === "fetching") {
        return { routeName, source: "osm" as const, progress: src.osm.progress };
      }
    }
    return null;
  }, [sourceRouteIds, routeNameById, allSourceInfo]);

  const activeTileDownload = useMemo(() => {
    for (const routeId of sourceRouteIds) {
      const info = routeInfo[routeId];
      if (info?.status === "downloading") {
        return { routeName: routeNameById[routeId] ?? "segment", info };
      }
    }
    return null;
  }, [sourceRouteIds, routeNameById, routeInfo]);

  const isPreparing = isDownloading || stats.anyDownloading || stats.anySourceFetching;
  const currentSegmentLabel =
    progress.total > 0
      ? `segment ${Math.min(progress.done + 1, progress.total)} / ${progress.total}`
      : (activePoiFetch?.routeName ?? activeTileDownload?.routeName ?? "segment");
  const activeSourceProgress = activePoiFetch?.progress;
  const activeStepFraction = activeTileDownload
    ? activeTileDownload.info.percentage / 100
    : activeSourceProgress
      ? activeSourceProgress.done / Math.max(1, activeSourceProgress.total)
      : 0;
  const aggregateProgress =
    progress.total > 0
      ? ((progress.done + Math.min(1, activeStepFraction)) / progress.total) * 100
      : 0;
  const activeStatus = activePoiFetch
    ? activeSourceProgress
      ? `${activeSourceProgress.phase} ${sourceLabel(activePoiFetch.source)}... ${activeSourceProgress.done}/${activeSourceProgress.total} (${currentSegmentLabel})`
      : `Fetching ${sourceLabel(activePoiFetch.source)}... (${currentSegmentLabel})`
    : activeTileDownload
      ? `Downloading map tiles... ${Math.round(activeTileDownload.info.percentage)}% (${currentSegmentLabel})`
      : `Preparing... ${progress.done} / ${progress.total}`;

  const handleDownloadAll = useCallback(async () => {
    setIsDownloading(true);
    setProgress({ done: 0, total: sourceRouteIds.length });

    for (let i = 0; i < sourceRouteIds.length; i++) {
      const routeId = sourceRouteIds[i];
      const info = routeInfo[routeId];
      const sources = allSourceInfo[routeId];
      const segmentReady =
        info?.status === "complete" &&
        isSourceReady(sources?.osm) &&
        isSourceReady(sources?.google);
      if (segmentReady) {
        setProgress({ done: i + 1, total: sourceRouteIds.length });
        continue;
      }
      try {
        const points = stitched.pointsByRouteId?.[routeId] ?? (await getRoutePoints(routeId));
        await prepareRouteOffline(routeId, points);
      } catch (error) {
        console.warn(`Failed to prepare segment ${routeNameById[routeId] ?? routeId}:`, error);
      }
      setProgress({ done: i + 1, total: sourceRouteIds.length });
    }

    setIsDownloading(false);
  }, [
    sourceRouteIds,
    routeInfo,
    allSourceInfo,
    stitched.pointsByRouteId,
    routeNameById,
    prepareRouteOffline,
  ]);

  const clearPOIs = usePoiStore((s) => s.clearPOIs);

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      "Delete All Offline Data",
      "Remove downloaded tiles and fetched POI data for all segments?",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            for (const routeId of sourceRouteIds) {
              await deleteOfflineData(routeId);
              await clearPOIs(routeId);
            }
          },
        },
      ],
    );
  }, [sourceRouteIds, deleteOfflineData, clearPOIs]);

  const handleDeleteAllPOIs = useCallback(() => {
    Alert.alert(
      "Delete Fetched POIs",
      "Remove fetched POI data for all segments in this collection?",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete Fetched POIs",
          style: "destructive",
          onPress: async () => {
            for (const routeId of sourceRouteIds) {
              await clearPOIs(routeId);
            }
          },
        },
      ],
    );
  }, [sourceRouteIds, clearPOIs]);

  return (
    <View>
      <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-4 mb-3">
        Offline
      </Text>

      <View className="mx-4 bg-card rounded-xl px-4 py-3 mb-3">
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-[15px] font-barlow text-foreground">Map tiles</Text>
          <Text className="text-[14px] font-barlow-sc-medium text-muted-foreground">
            {allTilesReady
              ? formatFileSize(stats.downloadedBytes)
              : `${stats.readyCount} / ${stats.total} segments`}
          </Text>
        </View>
        <View className="border-b border-border my-1" />
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-[15px] font-barlow text-foreground">POI data</Text>
          <Text className="text-[14px] font-barlow-sc-medium text-muted-foreground">
            {stats.poiReadyCount === stats.total && stats.total > 0
              ? `${stats.totalPOIs} POIs cached`
              : `${stats.poiReadyCount} / ${stats.total} segments`}
          </Text>
        </View>
      </View>

      {!allTilesReady && !isPreparing && (
        <Text className="text-[13px] text-muted-foreground px-4 mb-2 font-barlow">
          ~{formatFileSize(stats.estimatedBytes)} estimated for map tiles
        </Text>
      )}

      {isPreparing && (
        <View className="mx-4 mb-2">
          <View className="h-2 bg-border rounded-full overflow-hidden">
            <View
              className="h-full bg-primary rounded-full"
              style={{
                width: `${Math.min(100, aggregateProgress)}%`,
              }}
            />
          </View>
          <Text className="text-[13px] text-muted-foreground font-barlow mt-1">{activeStatus}</Text>
        </View>
      )}

      {poiErrors.length > 0 && (
        <View className="mx-4 mb-2">
          {poiErrors.map((e) => (
            <Text
              key={`${e.routeName}-${e.source}`}
              className="text-[13px] text-destructive font-barlow"
            >
              {e.routeName} ({e.source.toUpperCase()}): {e.error}
            </Text>
          ))}
        </View>
      )}

      <View className="px-4 mb-2">
        {!isConnected ? (
          <Button variant="secondary" disabled label="Connect to internet to download" />
        ) : (
          <Button
            onPress={handleDownloadAll}
            disabled={isPreparing || allOfflineReady}
            variant={allOfflineReady ? "secondary" : "default"}
            label={
              isDownloading
                ? "Preparing..."
                : allOfflineReady
                  ? "Offline Ready"
                  : "Prepare for Offline"
            }
          />
        )}
      </View>

      {stats.totalPOIs > 0 && (
        <TouchableOpacity
          className="px-4 py-2 min-h-[48px] justify-center"
          onPress={handleDeleteAllPOIs}
        >
          <Text className="text-[15px] font-barlow-medium text-destructive">
            Delete fetched POIs
          </Text>
        </TouchableOpacity>
      )}

      {allTilesReady && (
        <TouchableOpacity
          className="px-4 py-2 min-h-[48px] justify-center"
          onPress={handleDeleteAll}
        >
          <Text className="text-[15px] font-barlow-medium text-destructive">
            Delete all offline data
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
