import React, { useEffect, useCallback } from "react";
import {
  View,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { useThemeColors } from "@/theme";
import type { Route } from "@/types";

export default function RoutesScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const {
    routes,
    isLoading,
    error,
    loadRoutes,
    importRoute,
    deleteRoute,
    toggleVisibility,
    setActiveRoute,
    clearError,
  } = useRouteStore();

  const units = useSettingsStore((s) => s.units);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  useEffect(() => {
    if (error) {
      Alert.alert("Error", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error, clearError]);

  const handleDelete = useCallback(
    (route: Route) => {
      Alert.alert(
        "Delete Route",
        `Delete "${route.name}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteRoute(route.id),
          },
        ],
      );
    },
    [deleteRoute],
  );

  const borderColor = colors.border;

  const renderRoute = useCallback(
    ({ item: route }: { item: Route }) => (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => router.push(`/route/${route.id}`)}
      >
        <Card className="mb-3">
          <View className="flex-row items-center mb-2">
            <View
              className="w-3 h-3 rounded-full mr-3"
              style={{ backgroundColor: route.color }}
            />
            <Text className="flex-1 text-[17px] font-barlow-semibold text-foreground" numberOfLines={1}>
              {route.name}
            </Text>
            {route.isActive && <Badge label="Active" className="ml-2" />}
          </View>

          <View className="flex-row items-center mb-3">
            <Text className="text-sm text-muted-foreground font-barlow-sc-medium">
              {formatDistance(route.totalDistanceMeters, units)}
            </Text>
            <Text className="text-sm text-tertiary mx-2">·</Text>
            <Text className="text-sm text-muted-foreground font-barlow-sc-medium">
              ↑ {formatElevation(route.totalAscentMeters, units)}
            </Text>
            <Text className="text-sm text-tertiary mx-2">·</Text>
            <Text className="text-sm text-muted-foreground font-barlow-sc-medium">
              ↓ {formatElevation(route.totalDescentMeters, units)}
            </Text>
          </View>

          <View
            className="flex-row pt-3 gap-4"
            style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }}
          >
            <TouchableOpacity
              className={cn("min-h-[48px] justify-center", route.isActive && "opacity-50")}
              onPress={() => !route.isActive && setActiveRoute(route.id)}
              hitSlop={8}
            >
              <Text className={cn(
                "text-[15px] font-barlow-medium",
                route.isActive ? "text-muted-foreground" : "text-primary",
              )}>
                {route.isActive ? "Active" : "Set Active"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="min-h-[48px] justify-center"
              onPress={() => toggleVisibility(route.id)}
              hitSlop={8}
            >
              <Text className="text-[15px] font-barlow-medium text-primary">
                {route.isVisible ? "Hide" : "Show"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              className="min-h-[48px] justify-center"
              onPress={() => handleDelete(route)}
              hitSlop={8}
            >
              <Text className="text-[15px] font-barlow-medium text-destructive">
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        </Card>
      </TouchableOpacity>
    ),
    [units, router, setActiveRoute, toggleVisibility, handleDelete, borderColor],
  );

  return (
    <View className="flex-1 bg-background">
      {routes.length === 0 && !isLoading ? (
        <View className="flex-1 items-center justify-center pb-[100px]">
          <Text className="text-xl font-barlow-semibold text-foreground mb-2">
            No routes imported
          </Text>
          <Text className="text-[15px] text-muted-foreground">
            Import a GPX or KML file to get started
          </Text>
        </View>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(r) => r.id}
          renderItem={renderRoute}
          contentContainerStyle={{ padding: 16, paddingBottom: 96 }}
        />
      )}

      <Button
        className="absolute bottom-8 left-5 right-5"
        onPress={importRoute}
        disabled={isLoading}
        label={isLoading ? undefined : "Import Route"}
      >
        {isLoading && <ActivityIndicator color="#fff" />}
      </Button>
    </View>
  );
}
