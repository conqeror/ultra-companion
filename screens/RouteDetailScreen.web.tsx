import React, { useMemo, useCallback } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import StatBox from "@/components/common/StatBox";
import { useThemeColors } from "@/theme";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { formatDistance, formatElevation } from "@/utils/formatters";
import RoutePreviewMap from "@/components/map/RoutePreviewMap";
import DataSection from "@/components/route/DataSection";
import RouteFerriesSection from "@/components/ferry/RouteFerriesSection";
import { useRouteDetailModel } from "@/hooks/useRouteDetailModel";

export default function RouteDetailWebScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const setActiveRoute = useRouteStore((s) => s.setActiveRoute);
  const { route, loading, error, retry, routeFerries, displayFerries, previewLayers, ridingStats } =
    useRouteDetailModel(id);

  const screenOptions = useMemo(() => ({ title: route?.name ?? "Route" }), [route?.name]);

  const handleOpenOnMap = useCallback(async () => {
    if (!route) return;
    await setActiveRoute(route.id);
    router.replace("/");
  }, [route, router, setActiveRoute]);

  if (loading) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  if (!route) {
    return (
      <View className="flex-1 items-center justify-center bg-background">
        <Text className="text-[17px] text-muted-foreground">{error ?? "Route not found"}</Text>
        {error && <Button className="mt-4" onPress={retry} label="Try again" />}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={screenOptions} />
      <ScrollView className="flex-1 bg-background" contentContainerStyle={{ padding: 16, gap: 16 }}>
        <View className="gap-2">
          <Text className="text-[28px] font-barlow-semibold text-foreground">{route.name}</Text>
          <Text className="text-[15px] font-barlow text-muted-foreground">{route.fileName}</Text>
        </View>

        {previewLayers.length > 0 && (
          <View className="overflow-hidden rounded-xl" style={{ height: 250 }}>
            <RoutePreviewMap layers={previewLayers} ferries={displayFerries} />
          </View>
        )}

        <View className="flex-row gap-3">
          <StatBox label="Distance" value={formatDistance(ridingStats?.distance ?? 0, units)} />
          <StatBox label="Ascent" value={formatElevation(ridingStats?.ascent ?? 0, units)} />
          <StatBox label="Points" value={String(route.pointCount)} />
        </View>

        <RouteFerriesSection route={route} />

        <Button className="min-h-[52px]" onPress={handleOpenOnMap}>
          <Text className="font-barlow-semibold text-primary-foreground">Open on map</Text>
        </Button>

        <DataSection
          routeId={route.id}
          points={route.points}
          totalDistanceMeters={route.totalDistanceMeters}
          totalAscentMeters={route.totalAscentMeters}
          totalDescentMeters={route.totalDescentMeters}
          ferries={routeFerries}
        />
      </ScrollView>
    </>
  );
}
