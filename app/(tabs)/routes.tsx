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
import { useCollectionStore } from "@/store/collectionStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useOfflineStore } from "@/store/offlineStore";
import { ACTIVE_ROUTE_COLOR, INACTIVE_ROUTE_COLOR } from "@/constants";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { useThemeColors } from "@/theme";
import type { Route, Collection } from "@/types";

type SectionItem = { type: "collection"; data: Collection } | { type: "route"; data: Route };

export default function RoutesScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const {
    routes,
    isLoading,
    error,
    loadRouteMetadata,
    importRoute,
    deleteRoute,
    toggleVisibility,
    setActiveRoute,
    clearError,
  } = useRouteStore();

  const collections = useCollectionStore((s) => s.collections);
  const loadCollections = useCollectionStore((s) => s.loadCollections);
  const createCollection = useCollectionStore((s) => s.createCollection);
  const deleteCollection = useCollectionStore((s) => s.deleteCollection);
  const setActiveCollection = useCollectionStore((s) => s.setActiveCollection);
  const activeStitchedCollection = useCollectionStore((s) => s.activeStitchedCollection);
  const assignedRouteIds = useCollectionStore((s) => s.assignedRouteIds);

  const units = useSettingsStore((s) => s.units);
  const isRouteOfflineReady = useOfflineStore((s) => s.isRouteOfflineReady);

  // Metadata-only refresh; _layout.tsx prefetches on app startup so this is a
  // cheap no-op re-query in the common case. No point-fetch here — the routes
  // list only renders metadata.
  useEffect(() => {
    loadRouteMetadata();
    loadCollections();
  }, [loadRouteMetadata, loadCollections]);

  useEffect(() => {
    if (error) {
      Alert.alert("Error", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error, clearError]);

  const handleDeleteRoute = useCallback(
    (route: Route) => {
      Alert.alert("Delete Route", `Delete "${route.name}"? This cannot be undone.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteRoute(route.id),
        },
      ]);
    },
    [deleteRoute],
  );

  const handleDeleteCollection = useCallback(
    (collection: Collection) => {
      Alert.alert("Delete Collection", `Delete "${collection.name}"? Routes will not be deleted.`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => deleteCollection(collection.id),
        },
      ]);
    },
    [deleteCollection],
  );

  const handleCreateCollection = useCallback(() => {
    Alert.prompt(
      "New Collection",
      "Enter a name for the collection",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Create",
          onPress: async (name?: string) => {
            if (!name?.trim()) return;
            const id = await createCollection(name.trim());
            router.push(`/collection/${id}` as any);
          },
        },
      ],
      "plain-text",
    );
  }, [createCollection, router]);

  const borderColor = colors.border;

  const unassignedRoutes = useMemo(
    () => routes.filter((r) => !assignedRouteIds.has(r.id)),
    [routes, assignedRouteIds],
  );

  const sections = useMemo(() => {
    const s = [];
    if (collections.length > 0) {
      s.push({
        title: "Collections",
        data: collections.map((c): SectionItem => ({ type: "collection" as const, data: c })),
      });
    }
    if (unassignedRoutes.length > 0) {
      s.push({
        title: "Routes",
        data: unassignedRoutes.map((r): SectionItem => ({ type: "route" as const, data: r })),
      });
    }
    return s;
  }, [collections, unassignedRoutes]);

  const renderItem = useCallback(
    ({ item }: { item: SectionItem }) => {
      if (item.type === "collection") {
        const collection = item.data;
        const stitched = collection.isActive ? activeStitchedCollection : null;
        const segmentCount = stitched?.segments.length;
        return (
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => router.push(`/collection/${collection.id}` as any)}
          >
            <Card className="mb-3">
              <View className="flex-row items-center mb-2">
                <View
                  className="w-3 h-3 rounded-full mr-3"
                  style={{
                    backgroundColor: collection.isActive
                      ? ACTIVE_ROUTE_COLOR
                      : INACTIVE_ROUTE_COLOR,
                  }}
                />
                <Text
                  className="flex-1 text-[17px] font-barlow-semibold text-foreground"
                  numberOfLines={1}
                >
                  {collection.name}
                </Text>
                {collection.isActive && <Badge label="Active" className="ml-2" />}
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
                  className={cn("min-h-[48px] justify-center", collection.isActive && "opacity-50")}
                  onPress={() => !collection.isActive && setActiveCollection(collection.id)}
                  hitSlop={8}
                >
                  <Text
                    className={cn(
                      "text-[15px] font-barlow-medium",
                      collection.isActive ? "text-muted-foreground" : "text-primary",
                    )}
                  >
                    {collection.isActive ? "Active" : "Set Active"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="min-h-[48px] justify-center"
                  onPress={() => handleDeleteCollection(collection)}
                  hitSlop={8}
                >
                  <Text className="text-[15px] font-barlow-medium text-destructive">Delete</Text>
                </TouchableOpacity>
              </View>
            </Card>
          </TouchableOpacity>
        );
      }

      const route = item.data;
      return (
        <TouchableOpacity activeOpacity={0.7} onPress={() => router.push(`/route/${route.id}`)}>
          <Card className="mb-3">
            <View className="flex-row items-center mb-2">
              <View
                className="w-3 h-3 rounded-full mr-3"
                style={{
                  backgroundColor: route.isActive ? ACTIVE_ROUTE_COLOR : INACTIVE_ROUTE_COLOR,
                }}
              />
              <Text
                className="flex-1 text-[17px] font-barlow-semibold text-foreground"
                numberOfLines={1}
              >
                {route.name}
              </Text>
              {route.isActive && <Badge label="Active" className="ml-2" />}
              {isRouteOfflineReady(route.id) && (
                <Badge label="Offline" variant="outline" className="ml-2" />
              )}
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
                <Text
                  className={cn(
                    "text-[15px] font-barlow-medium",
                    route.isActive ? "text-muted-foreground" : "text-primary",
                  )}
                >
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
                <Text className="text-[15px] font-barlow-medium text-destructive">Delete</Text>
              </TouchableOpacity>
            </View>
          </Card>
        </TouchableOpacity>
      );
    },
    [
      units,
      router,
      setActiveRoute,
      setActiveCollection,
      toggleVisibility,
      handleDeleteRoute,
      handleDeleteCollection,
      borderColor,
      isRouteOfflineReady,
      activeStitchedCollection,
    ],
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

  const isEmpty = unassignedRoutes.length === 0 && collections.length === 0 && !isLoading;

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
          onPress={handleCreateCollection}
          label="New Collection"
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
