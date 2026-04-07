import React, { useMemo, useState, useCallback } from "react";
import { View, TouchableOpacity, Alert } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useOfflineStore } from "@/store/offlineStore";
import { usePoiStore } from "@/store/poiStore";
import type { StitchedCollection } from "@/types";
import { formatFileSize } from "@/utils/formatters";
import { estimateDownloadSize } from "@/services/offlineTiles";
import { getRoutePoints } from "@/db/database";

interface CollectionOfflineSectionProps {
  stitched: StitchedCollection;
}

export default function CollectionOfflineSection({ stitched }: CollectionOfflineSectionProps) {
  const isConnected = useOfflineStore((s) => s.isConnected);
  const startDownload = useOfflineStore((s) => s.startDownload);
  const deleteOfflineData = useOfflineStore((s) => s.deleteOfflineData);
  const routeInfo = useOfflineStore((s) => s.routeInfo);
  const allPois = usePoiStore((s) => s.pois);

  const [isDownloading, setIsDownloading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const segments = stitched.segments;

  const stats = useMemo(() => {
    let readyCount = 0;
    let downloadedBytes = 0;
    let estimatedBytes = 0;
    let totalPOIs = 0;
    let anyDownloading = false;

    for (const seg of segments) {
      const info = routeInfo[seg.routeId];
      if (info?.status === "complete") {
        readyCount++;
        downloadedBytes += info.downloadedBytes;
      }
      if (info?.status === "downloading") anyDownloading = true;
      totalPOIs += allPois[seg.routeId]?.length ?? 0;
    }

    // Estimate from stitched points (rough)
    estimatedBytes = estimateDownloadSize(stitched.points);

    return { readyCount, total: segments.length, downloadedBytes, estimatedBytes, totalPOIs, anyDownloading };
  }, [segments, routeInfo, allPois, stitched.points]);

  const allReady = stats.readyCount === stats.total && stats.total > 0;

  const handleDownloadAll = useCallback(async () => {
    setIsDownloading(true);
    setProgress({ done: 0, total: segments.length });

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const info = routeInfo[seg.routeId];
      if (info?.status === "complete") {
        setProgress({ done: i + 1, total: segments.length });
        continue;
      }
      try {
        const points = stitched.pointsByRouteId?.[seg.routeId]
          ?? await getRoutePoints(seg.routeId);
        await startDownload(seg.routeId, points);
      } catch (e: any) {
        console.warn(`Failed to download segment ${seg.routeName}:`, e);
      }
      setProgress({ done: i + 1, total: segments.length });
    }

    setIsDownloading(false);
  }, [segments, routeInfo, stitched.pointsByRouteId, startDownload]);

  const clearPOIs = usePoiStore((s) => s.clearPOIs);

  const handleDeleteAll = useCallback(() => {
    Alert.alert(
      "Delete All Offline Data",
      "Remove downloaded tiles and POI data for all segments?",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            for (const seg of segments) {
              await deleteOfflineData(seg.routeId);
              await clearPOIs(seg.routeId);
            }
          },
        },
      ],
    );
  }, [segments, deleteOfflineData, clearPOIs]);

  const handleDeleteAllPOIs = useCallback(() => {
    Alert.alert(
      "Delete All POIs",
      "Remove all POI data for all segments in this collection?",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete All POIs",
          style: "destructive",
          onPress: async () => {
            for (const seg of segments) {
              await clearPOIs(seg.routeId);
            }
          },
        },
      ],
    );
  }, [segments, clearPOIs]);

  return (
    <View>
      <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-4 mb-3">
        Offline
      </Text>

      <View className="mx-4 bg-card rounded-xl px-4 py-3 mb-3">
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-[15px] font-barlow text-foreground">Map tiles</Text>
          <Text className="text-[14px] font-barlow-sc-medium text-muted-foreground">
            {allReady
              ? formatFileSize(stats.downloadedBytes)
              : `${stats.readyCount} / ${stats.total} segments`}
          </Text>
        </View>
        <View className="border-b border-border my-1" />
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-[15px] font-barlow text-foreground">POI data</Text>
          <Text className="text-[14px] font-barlow-sc-medium text-muted-foreground">
            {stats.totalPOIs > 0 ? `${stats.totalPOIs} POIs cached` : "Not fetched"}
          </Text>
        </View>
      </View>

      {!allReady && !isDownloading && !stats.anyDownloading && (
        <Text className="text-[13px] text-muted-foreground px-4 mb-2 font-barlow">
          ~{formatFileSize(stats.estimatedBytes)} estimated for map tiles
        </Text>
      )}

      {(isDownloading || stats.anyDownloading) && (
        <View className="mx-4 mb-2">
          <View className="h-2 bg-border rounded-full overflow-hidden">
            <View
              className="h-full bg-primary rounded-full"
              style={{ width: `${Math.min(100, (progress.done / Math.max(1, progress.total)) * 100)}%` }}
            />
          </View>
          <Text className="text-[13px] text-muted-foreground font-barlow mt-1">
            Downloading segment {progress.done} / {progress.total}
          </Text>
        </View>
      )}

      <View className="px-4 mb-2">
        {!isConnected ? (
          <Button
            variant="secondary"
            disabled
            label="Connect to internet to download"
          />
        ) : (
          <Button
            onPress={handleDownloadAll}
            disabled={isDownloading || stats.anyDownloading}
            variant={allReady ? "secondary" : "default"}
            label={
              isDownloading
                ? "Downloading..."
                : allReady
                  ? "Update All Offline Data"
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
            Delete all POIs
          </Text>
        </TouchableOpacity>
      )}

      {allReady && (
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
