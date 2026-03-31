import React from "react";
import { View, Alert } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import type { RoutePoint } from "@/types";
import { usePoiStore, DEFAULT_SOURCE_INFO, type SourceInfo } from "@/store/poiStore";
import { useOfflineStore } from "@/store/offlineStore";
import { formatFileSize } from "@/utils/formatters";
import { estimateDownloadSize } from "@/services/offlineTiles";

interface DataSectionProps {
  routeId: string;
  points: RoutePoint[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const month = d.toLocaleString("en", { month: "short" });
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${month}, ${h}:${m}`;
}

export default function DataSection({ routeId, points }: DataSectionProps) {

  // Map tiles state
  const tileInfo = useOfflineStore((s) => s.getRouteInfo(routeId));
  const isConnected = useOfflineStore((s) => s.isConnected);
  const startTileDownload = useOfflineStore((s) => s.startDownload);
  const deleteTiles = useOfflineStore((s) => s.deleteOfflineData);
  const tilesReady = tileInfo.status === "complete";
  const tilesDownloading = tileInfo.status === "downloading";

  // POI state — subscribe to raw state so Zustand re-renders on changes
  const osmInfo = usePoiStore((s) => s.sourceInfo[routeId]?.osm) ?? DEFAULT_SOURCE_INFO;
  const googleInfo = usePoiStore((s) => s.sourceInfo[routeId]?.google) ?? DEFAULT_SOURCE_INFO;
  const fetchSource = usePoiStore((s) => s.fetchSource);
  const clearSource = usePoiStore((s) => s.clearSource);
  const fetchProgress = usePoiStore((s) => s.fetchProgress);

  const handleDeleteTiles = () => {
    Alert.alert("Delete Map Tiles", "Remove downloaded tiles for this route?", [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => deleteTiles(routeId) },
    ]);
  };

  const handleCancelTiles = () => {
    Alert.alert("Cancel Download", "Stop downloading map tiles?", [
      { text: "Continue", style: "cancel" },
      { text: "Cancel", style: "destructive", onPress: () => deleteTiles(routeId) },
    ]);
  };

  const handleDeleteSource = (source: "osm" | "google", label: string) => {
    Alert.alert(`Delete ${label}`, `Remove ${label.toLowerCase()} for this route?`, [
      { text: "Keep", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => clearSource(routeId, source) },
    ]);
  };

  return (
    <View>
      <Text className="text-[22px] font-barlow-semibold text-foreground px-4 mt-4 mb-3">
        Data
      </Text>

      {/* Map Tiles */}
      <DataRow
        title="Map tiles"
        subtitle={
          tilesReady
            ? formatFileSize(tileInfo.downloadedBytes)
            : tilesDownloading
              ? `Downloading... ${Math.round(tileInfo.percentage)}%`
              : `~${formatFileSize(estimateDownloadSize(points))} estimated`
        }
        timestamp={tileInfo.downloadedAt ? formatDate(tileInfo.downloadedAt) : null}
        error={tileInfo.status === "error" ? tileInfo.error : null}
        progress={tilesDownloading ? tileInfo.percentage : undefined}

      />
      <View className="flex-row px-4 mb-4 gap-3">
        {tilesDownloading ? (
          <View className="flex-1">
            <Button variant="secondary" size="sm" onPress={handleCancelTiles} label="Cancel" />
          </View>
        ) : (
          <>
            <View className="flex-1">
              <Button
                size="sm"
                variant={tilesReady ? "secondary" : "default"}
                disabled={!isConnected}
                onPress={() => startTileDownload(routeId, points)}
                label={tilesReady ? "Refresh" : "Download"}
              />
            </View>
            {tilesReady && (
              <View className="flex-1">
                <Button
                  size="sm"
                  variant="destructive"
                  onPress={handleDeleteTiles}
                  label="Delete"
                />
              </View>
            )}
          </>
        )}
      </View>

      {/* Google Places */}
      <SourceRow
        title="Google Places"
        subtitle="Gas stations, groceries"
        info={googleInfo}
        progress={googleInfo.status === "fetching" ? fetchProgress : null}

        onFetch={() => fetchSource(routeId, "google", points)}
        onDelete={() => handleDeleteSource("google", "Google Places data")}
        isConnected={isConnected}
      />

      {/* OSM / Overpass */}
      <SourceRow
        title="OpenStreetMap"
        subtitle="Water, bike shops, ATMs, pharmacies, WC, shelters"
        info={osmInfo}
        progress={osmInfo.status === "fetching" ? fetchProgress : null}

        onFetch={() => fetchSource(routeId, "osm", points)}
        onDelete={() => handleDeleteSource("osm", "OSM data")}
        isConnected={isConnected}
      />
    </View>
  );
}

// --- Reusable row components ---

function DataRow({
  title,
  subtitle,
  timestamp,
  error,
  progress,
}: {
  title: string;
  subtitle: string;
  timestamp: string | null;
  error: string | null;
  progress?: number;
}) {
  return (
    <View className="mx-4 bg-card rounded-xl px-4 py-3 mb-2">
      <View className="flex-row items-center justify-between">
        <Text className="text-[15px] font-barlow-semibold text-foreground">{title}</Text>
        <Text className="text-[13px] font-barlow-sc-medium text-muted-foreground">{subtitle}</Text>
      </View>
      {progress != null && (
        <View className="h-2 bg-border rounded-full overflow-hidden mt-2">
          <View
            className="h-full bg-primary rounded-full"
            style={{ width: `${Math.min(100, progress)}%` }}
          />
        </View>
      )}
      {timestamp && (
        <Text className="text-[13px] text-muted-foreground font-barlow mt-1">
          Fetched {timestamp}
        </Text>
      )}
      {error && (
        <Text className="text-[13px] text-destructive font-barlow mt-1">
          {error}
        </Text>
      )}
    </View>
  );
}

function SourceRow({
  title,
  subtitle,
  info,
  progress,
  onFetch,
  onDelete,
  isConnected,
}: {
  title: string;
  subtitle: string;
  info: SourceInfo;
  progress: { phase: string; done: number; total: number } | null;
  onFetch: () => void;
  onDelete: () => void;
  isConnected: boolean;
}) {
  const isFetching = info.status === "fetching";
  const hasData = info.count > 0;

  return (
    <>
      <DataRow
        title={title}
        subtitle={
          isFetching && progress
            ? `${progress.phase}: ${progress.done}/${progress.total}`
            : hasData
              ? `${info.count} POIs`
              : "Not fetched"
        }
        timestamp={info.fetchedAt ? formatDate(info.fetchedAt) : null}
        error={info.status === "error" ? info.error : null}

      />
      <View className="flex-row px-4 mb-4 gap-3">
        <View className="flex-1">
          <Button
            size="sm"
            variant={hasData ? "secondary" : "default"}
            disabled={isFetching || !isConnected}
            onPress={onFetch}
            label={isFetching ? "Fetching..." : hasData ? "Refresh" : "Fetch"}
          />
        </View>
        {hasData && (
          <View className="flex-1">
            <Button
              size="sm"
              variant="destructive"
              onPress={onDelete}
              label="Delete"
            />
          </View>
        )}
      </View>
    </>
  );
}
