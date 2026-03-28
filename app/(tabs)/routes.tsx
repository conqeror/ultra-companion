import React, { useEffect, useCallback, useMemo } from "react";
import {
  View,
  SectionList,
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
import { useRaceStore } from "@/store/raceStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useOfflineStore } from "@/store/offlineStore";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { useThemeColors } from "@/theme";
import type { Route, Race } from "@/types";

type SectionItem = { type: "race"; data: Race } | { type: "route"; data: Route };

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

  const races = useRaceStore((s) => s.races);
  const loadRaces = useRaceStore((s) => s.loadRaces);
  const createRace = useRaceStore((s) => s.createRace);
  const deleteRace = useRaceStore((s) => s.deleteRace);
  const setActiveRace = useRaceStore((s) => s.setActiveRace);
  const activeStitchedRace = useRaceStore((s) => s.activeStitchedRace);
  const assignedRouteIds = useRaceStore((s) => s.assignedRouteIds);

  const units = useSettingsStore((s) => s.units);
  const isRouteOfflineReady = useOfflineStore((s) => s.isRouteOfflineReady);

  useEffect(() => {
    loadRoutes();
    loadRaces();
  }, [loadRoutes, loadRaces]);

  useEffect(() => {
    if (error) {
      Alert.alert("Error", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error, clearError]);

  const handleDeleteRoute = useCallback(
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

  const handleDeleteRace = useCallback(
    (race: Race) => {
      Alert.alert(
        "Delete Race",
        `Delete "${race.name}"? Routes will not be deleted.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteRace(race.id),
          },
        ],
      );
    },
    [deleteRace],
  );

  const handleCreateRace = useCallback(() => {
    Alert.prompt(
      "New Race",
      "Enter a name for the race",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: async (name?: string) => {
            if (!name?.trim()) return;
            const id = await createRace(name.trim());
            router.push(`/race/${id}`);
          },
        },
      ],
      "plain-text",
    );
  }, [createRace, router]);

  const borderColor = colors.border;

  const unassignedRoutes = useMemo(
    () => routes.filter((r) => !assignedRouteIds.has(r.id)),
    [routes, assignedRouteIds],
  );

  const sections = useMemo(() => {
    const s = [];
    if (races.length > 0) {
      s.push({
        title: "Races",
        data: races.map((r): SectionItem => ({ type: "race" as const, data: r })),
      });
    }
    if (unassignedRoutes.length > 0) {
      s.push({
        title: "Routes",
        data: unassignedRoutes.map((r): SectionItem => ({ type: "route" as const, data: r })),
      });
    }
    return s;
  }, [races, unassignedRoutes]);

  const renderItem = useCallback(
    ({ item }: { item: SectionItem }) => {
      if (item.type === "race") {
        const race = item.data;
        const stitched = race.isActive ? activeStitchedRace : null;
        const segmentCount = stitched?.segments.length;
        return (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push(`/race/${race.id}` as any)}
          >
            <Card className="mb-3">
              <View className="flex-row items-center mb-2">
                <View
                  className="w-3 h-3 rounded-full mr-3"
                  style={{ backgroundColor: race.isActive ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR }}
                />
                <Text className="flex-1 text-[17px] font-barlow-semibold text-foreground" numberOfLines={1}>
                  {race.name}
                </Text>
                {race.isActive && <Badge label="Active" className="ml-2" />}
              </View>

              {stitched && (
                <View className="flex-row items-center mb-3">
                  <Text className="text-sm text-muted-foreground font-barlow-sc-medium">
                    {formatDistance(stitched.totalDistanceMeters, units)}
                  </Text>
                  <Text className="text-sm text-tertiary mx-2">·</Text>
                  <Text className="text-sm text-muted-foreground font-barlow-sc-medium">
                    ↑ {formatElevation(stitched.totalAscentMeters, units)}
                  </Text>
                  {segmentCount != null && (
                    <>
                      <Text className="text-sm text-tertiary mx-2">·</Text>
                      <Text className="text-sm text-muted-foreground font-barlow-sc-medium">
                        {segmentCount} segments
                      </Text>
                    </>
                  )}
                </View>
              )}

              <View
                className="flex-row pt-3 gap-4"
                style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: borderColor }}
              >
                <TouchableOpacity
                  className={cn("min-h-[48px] justify-center", race.isActive && "opacity-50")}
                  onPress={() => !race.isActive && setActiveRace(race.id)}
                  hitSlop={8}
                >
                  <Text className={cn(
                    "text-[15px] font-barlow-medium",
                    race.isActive ? "text-muted-foreground" : "text-primary",
                  )}>
                    {race.isActive ? "Active" : "Set Active"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="min-h-[48px] justify-center"
                  onPress={() => handleDeleteRace(race)}
                  hitSlop={8}
                >
                  <Text className="text-[15px] font-barlow-medium text-destructive">
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </Card>
          </TouchableOpacity>
        );
      }

      const route = item.data;
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push(`/route/${route.id}`)}
        >
          <Card className="mb-3">
            <View className="flex-row items-center mb-2">
              <View
                className="w-3 h-3 rounded-full mr-3"
                style={{ backgroundColor: route.isActive ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR }}
              />
              <Text className="flex-1 text-[17px] font-barlow-semibold text-foreground" numberOfLines={1}>
                {route.name}
              </Text>
              {route.isActive && <Badge label="Active" className="ml-2" />}
              {isRouteOfflineReady(route.id) && <Badge label="Offline" variant="outline" className="ml-2" />}
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
                onPress={() => handleDeleteRoute(route)}
                hitSlop={8}
              >
                <Text className="text-[15px] font-barlow-medium text-destructive">
                  Delete
                </Text>
              </TouchableOpacity>
            </View>
          </Card>
        </TouchableOpacity>
      );
    },
    [units, router, setActiveRoute, setActiveRace, toggleVisibility, handleDeleteRoute, handleDeleteRace, borderColor, isRouteOfflineReady, activeStitchedRace],
  );

  const renderSectionHeader = useCallback(
    ({ section }: { section: { title: string } }) => (
      <View className="pb-2 pt-1">
        <Text className="text-[13px] font-barlow-semibold text-muted-foreground uppercase tracking-wide">
          {section.title}
        </Text>
      </View>
    ),
    [],
  );

  const isEmpty = unassignedRoutes.length === 0 && races.length === 0 && !isLoading;

  return (
    <View className="flex-1 bg-background">
      {isEmpty ? (
        <View className="flex-1 items-center justify-center pb-[100px]">
          <Text className="text-xl font-barlow-semibold text-foreground mb-2">
            No routes imported
          </Text>
          <Text className="text-[15px] text-muted-foreground">
            Import a GPX or KML file to get started
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => `${item.type}-${item.data.id}`}
          renderItem={renderItem}
          renderSectionHeader={renderSectionHeader}
          contentContainerStyle={{ padding: 16, paddingBottom: 112 }}
          stickySectionHeadersEnabled={false}
        />
      )}

      <View className="absolute bottom-0 left-0 right-0 px-5 pb-8 pt-3 flex-row gap-3 bg-background">
        <Button
          className="flex-1"
          variant="secondary"
          onPress={handleCreateRace}
          label="New Race"
        />
        <Button
          className="flex-1"
          onPress={importRoute}
          disabled={isLoading}
          label={isLoading ? undefined : "Import Route"}
        >
          {isLoading && <ActivityIndicator color="#fff" />}
        </Button>
      </View>
    </View>
  );
}
