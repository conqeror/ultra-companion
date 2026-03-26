import React, { useMemo } from "react";
import { View, TouchableOpacity, Alert } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/theme";
import { useOfflineStore } from "@/store/offlineStore";
import { usePoiStore } from "@/store/poiStore";
import { useSettingsStore } from "@/store/settingsStore";
import type { RoutePoint } from "@/types";
import { formatFileSize } from "@/utils/formatters";

interface OfflineSectionProps {
  routeId: string;
  points: RoutePoint[];
}

const MAP_STYLE_LABELS: Record<string, string> = {
  streets: "Streets",
  outdoors: "Outdoors",
  satellite: "Satellite",
};

export default function OfflineSection({ routeId, points }: OfflineSectionProps) {
  const colors = useThemeColors();
  const info = useOfflineStore((s) => s.getRouteInfo(routeId));
  const isConnected = useOfflineStore((s) => s.isConnected);
  const startDownload = useOfflineStore((s) => s.startDownload);
  const cancelDownload = useOfflineStore((s) => s.cancelDownload);
  const deleteOfflineData = useOfflineStore((s) => s.deleteOfflineData);
  const getEstimate = useOfflineStore((s) => s.getEstimate);
  const mapStyle = useSettingsStore((s) => s.mapStyle);
  const poiCount = usePoiStore((s) => s.pois[routeId]?.length ?? 0);

  const estimatedBytes = useMemo(() => getEstimate(points), [points, getEstimate]);
  const hasData = info.status === "complete";
  const isDownloading = info.status === "downloading";

  const handlePrepare = () => {
    startDownload(routeId, points, mapStyle);
  };

  const handleCancel = () => {
    Alert.alert("Cancel Download", "Stop downloading offline data?", [
      { text: "Continue", style: "cancel" },
      { text: "Cancel Download", style: "destructive", onPress: () => cancelDownload(routeId) },
    ]);
  };

  const handleDelete = () => {
    Alert.alert("Delete Offline Data", "Remove downloaded map tiles for this route?", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteOfflineData(routeId) },
    ]);
  };

  return (
    <View>
      <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-4 mb-3">
        Offline
      </Text>

      {/* Status card */}
      <View className="mx-4 bg-card rounded-xl px-4 py-3 mb-3">
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-[15px] font-barlow text-foreground">Map tiles</Text>
          <Text className="text-[14px] font-barlow-sc-medium text-muted-foreground">
            {hasData
              ? `${formatFileSize(info.downloadedBytes)}${info.mapStyle ? `, ${MAP_STYLE_LABELS[info.mapStyle] ?? info.mapStyle}` : ""}`
              : "Not downloaded"}
          </Text>
        </View>
        <View className="border-b border-border my-1" />
        <View className="flex-row items-center justify-between py-1">
          <Text className="text-[15px] font-barlow text-foreground">POI data</Text>
          <Text className="text-[14px] font-barlow-sc-medium text-muted-foreground">
            {poiCount > 0 ? `${poiCount} POIs cached` : "Not fetched"}
          </Text>
        </View>
      </View>

      {/* Estimate (before download) */}
      {!hasData && !isDownloading && (
        <Text className="text-[13px] text-muted-foreground px-4 mb-2 font-barlow">
          ~{formatFileSize(estimatedBytes)} estimated for map tiles
        </Text>
      )}

      {/* Progress bar */}
      {isDownloading && (
        <View className="mx-4 mb-2">
          <View className="h-2 bg-border rounded-full overflow-hidden">
            <View
              className="h-full bg-primary rounded-full"
              style={{ width: `${Math.min(100, info.percentage)}%` }}
            />
          </View>
          <Text className="text-[13px] text-muted-foreground font-barlow mt-1">
            Downloading... {Math.round(info.percentage)}%
            {info.downloadedBytes > 0 ? ` (${formatFileSize(info.downloadedBytes)})` : ""}
          </Text>
        </View>
      )}

      {/* Error */}
      {info.status === "error" && info.error && (
        <Text className="text-[13px] text-destructive px-4 mb-2 font-barlow">
          {info.error}
        </Text>
      )}

      {/* Action button */}
      <View className="px-4 mb-2">
        {isDownloading ? (
          <Button
            variant="secondary"
            size="sm"
            onPress={handleCancel}
            label="Cancel Download"
          />
        ) : !isConnected ? (
          <Button
            variant="secondary"
            disabled
            label="Connect to internet to download"
          />
        ) : (
          <Button
            onPress={handlePrepare}
            variant={hasData ? "secondary" : "default"}
            label={
              hasData
                ? "Update Offline Data"
                : info.status === "error"
                  ? "Retry Download"
                  : "Prepare for Offline"
            }
          />
        )}
      </View>

      {/* Delete button */}
      {hasData && (
        <TouchableOpacity
          className="px-4 py-2 min-h-[48px] justify-center"
          onPress={handleDelete}
        >
          <Text className="text-[15px] font-barlow-medium text-destructive">
            Delete offline data
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
