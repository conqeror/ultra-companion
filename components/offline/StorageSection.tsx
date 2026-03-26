import React from "react";
import { View, TouchableOpacity, Alert, StyleSheet } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useThemeColors } from "@/theme";
import { useOfflineStore } from "@/store/offlineStore";
import { useRouteStore } from "@/store/routeStore";
import { formatFileSize } from "@/utils/formatters";

const MAP_STYLE_LABELS: Record<string, string> = {
  streets: "Streets",
  outdoors: "Outdoors",
  satellite: "Satellite",
};

export default function StorageSection() {
  const colors = useThemeColors();
  const routeInfo = useOfflineStore((s) => s.routeInfo);
  const deleteOfflineData = useOfflineStore((s) => s.deleteOfflineData);
  const getTotalStorageBytes = useOfflineStore((s) => s.getTotalStorageBytes);
  const routes = useRouteStore((s) => s.routes);

  const totalBytes = getTotalStorageBytes();

  // Only show routes that have offline data
  const offlineRoutes = routes.filter(
    (r) => routeInfo[r.id]?.status === "complete",
  );

  if (offlineRoutes.length === 0 && totalBytes === 0) {
    return (
      <View>
        <Text className="text-[22px] font-barlow-semibold text-foreground mt-8 mb-3">
          Storage
        </Text>
        <Text className="text-[14px] text-muted-foreground font-barlow">
          No offline data downloaded
        </Text>
      </View>
    );
  }

  const handleDeleteAll = () => {
    Alert.alert(
      "Delete All Offline Data",
      "Remove all downloaded map tiles? This cannot be undone.",
      [
        { text: "Keep", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: async () => {
            for (const route of offlineRoutes) {
              await deleteOfflineData(route.id);
            }
          },
        },
      ],
    );
  };

  const handleDeleteRoute = (routeId: string, routeName: string) => {
    Alert.alert(
      "Delete Offline Data",
      `Remove map tiles for "${routeName}"?`,
      [
        { text: "Keep", style: "cancel" },
        { text: "Delete", style: "destructive", onPress: () => deleteOfflineData(routeId) },
      ],
    );
  };

  return (
    <View>
      <Text className="text-[22px] font-barlow-semibold text-foreground mt-8 mb-1">
        Storage
      </Text>
      <Text className="text-[13px] text-muted-foreground font-barlow mb-3">
        {formatFileSize(totalBytes)} used for offline maps
      </Text>

      <View className="bg-card rounded-xl px-4">
        {offlineRoutes.map((route, index) => {
          const info = routeInfo[route.id];
          return (
            <View key={route.id}>
              {index > 0 && (
                <View
                  style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }}
                />
              )}
              <View className="flex-row items-center justify-between py-3">
                <View className="flex-row items-center flex-1 mr-3">
                  <View
                    className="w-3 h-3 rounded-full mr-2"
                    style={{ backgroundColor: route.color }}
                  />
                  <Text className="text-[15px] font-barlow text-foreground flex-1" numberOfLines={1}>
                    {route.name}
                  </Text>
                </View>
                <View className="flex-row items-center gap-3">
                  <Text className="text-[13px] font-barlow-sc-medium text-muted-foreground">
                    {info ? formatFileSize(info.downloadedBytes) : ""}
                    {info?.mapStyle ? ` · ${MAP_STYLE_LABELS[info.mapStyle] ?? info.mapStyle}` : ""}
                  </Text>
                  <TouchableOpacity
                    className="min-h-[44px] justify-center"
                    onPress={() => handleDeleteRoute(route.id, route.name)}
                    hitSlop={8}
                  >
                    <Text className="text-[14px] font-barlow-medium text-destructive">
                      Delete
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      {offlineRoutes.length > 1 && (
        <View className="mt-3">
          <Button
            variant="destructive"
            size="sm"
            onPress={handleDeleteAll}
            label="Delete All Offline Data"
          />
        </View>
      )}
    </View>
  );
}
