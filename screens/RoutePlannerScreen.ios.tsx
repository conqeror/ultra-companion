import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, Linking, View } from "react-native";
import { Stack, useNavigation, useRouter } from "expo-router";
import { usePreventRemove } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import TextPromptModal from "@/components/common/TextPromptModal";
import RoutePlannerMap from "@/components/map/RoutePlannerMap";
import { useRoutePlannerStore } from "@/store/routePlannerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useThemeColors } from "@/theme";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react-native";
import BRouterProfilePicker from "@/components/route/BRouterProfilePicker";

export default function RoutePlannerScreen() {
  const planner = useRoutePlannerStore();
  const {
    waypoints,
    profile,
    preview,
    error,
    isRouting,
    isSaving,
    savedRoute,
    addWaypoint,
    undo,
    reset,
    calculate,
    save,
  } = planner;
  const units = useSettingsStore((s) => s.units);
  const [naming, setNaming] = useState(false);
  const [choosingProfile, setChoosingProfile] = useState(false);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();

  usePreventRemove(waypoints.length > 0 && !savedRoute, ({ data }) => {
    if (isSaving) return;
    Alert.alert("Discard planned route?", "This route has not been saved.", [
      { text: "Keep planning", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: () => navigation.dispatch(data.action) },
    ]);
  });

  useEffect(() => {
    if (waypoints.length < 2) return;
    const timer = setTimeout(() => void calculate(), 500);
    return () => clearTimeout(timer);
  }, [waypoints, profile, calculate]);

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    if (savedRoute && !isSaving) {
      router.replace({ pathname: "/route/[id]", params: { id: savedRoute.id } });
    }
  }, [savedRoute, isSaving, router]);

  const canSave = preview != null && !isRouting && !isSaving;
  const canEdit = waypoints.length > 0 && !isSaving;
  const instruction =
    waypoints.length === 0
      ? "Tap the map to set your start."
      : waypoints.length === 1
        ? "Tap the map to set your destination."
        : "Tap to extend the route. Previous ends become via points.";

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ title: "New route", gestureEnabled: !isSaving }} />
      <RoutePlannerMap
        waypoints={waypoints}
        points={preview?.points ?? null}
        disabled={isSaving || naming || choosingProfile}
        onAddPoint={addWaypoint}
      />
      <View
        className="border-t border-border bg-surface px-4 pt-3 gap-3"
        style={{ paddingBottom: Math.max(insets.bottom, 12) }}
      >
        <View>
          <View className="flex-row items-center justify-between gap-3">
            <Button
              variant="secondary"
              className="flex-1 px-3"
              disabled={isSaving}
              accessibilityRole="button"
              accessibilityLabel={`Routing profile: ${profile?.name ?? "Road cycling"}`}
              onPress={() => setChoosingProfile(true)}
            >
              <Text
                numberOfLines={1}
                className="flex-1 text-[15px] font-barlow-semibold text-primary"
              >
                {profile?.name ?? "Road cycling"}
              </Text>
              <ChevronDown size={20} color={colors.accent} />
            </Button>
            <Text className="text-[13px] text-muted-foreground">
              Online · {waypoints.length} {waypoints.length === 1 ? "point" : "points"}
            </Text>
          </View>
          <Text className="mt-1 text-[13px] text-muted-foreground">{instruction}</Text>
        </View>
        <View accessibilityLiveRegion="polite">
          {isRouting || (waypoints.length >= 2 && !preview && !error) ? (
            <View
              className="flex-row items-center gap-2"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Calculating route"
            >
              <ActivityIndicator color={colors.accent} />
              <Text className="text-[17px] text-foreground">Calculating route…</Text>
            </View>
          ) : preview ? (
            <Text className="text-[24px] font-barlow-sc-semibold text-foreground">
              {formatDistance(preview.totalDistanceMeters, units)} · ↑{" "}
              {formatElevation(preview.totalAscentMeters, units)}
            </Text>
          ) : null}
          {error && (
            <Text accessibilityRole="alert" className="text-[15px] text-destructive">
              {error}
            </Text>
          )}
        </View>
        <View className="flex-row gap-3">
          <Button
            className={cn("flex-1", !canEdit && "opacity-50")}
            variant="secondary"
            label="Undo"
            accessibilityRole="button"
            accessibilityLabel="Undo last route point"
            disabled={!canEdit}
            onPress={undo}
          />
          <Button
            className={cn("flex-1", !canEdit && "opacity-50")}
            variant="secondary"
            label="Clear"
            accessibilityRole="button"
            accessibilityLabel="Clear planned route"
            disabled={!canEdit}
            onPress={reset}
          />
          {error && !preview ? (
            <Button
              className="flex-1"
              label="Retry"
              accessibilityRole="button"
              onPress={() => void calculate()}
            />
          ) : (
            <Button
              className={cn("flex-1", !canSave && "opacity-50")}
              label={isSaving ? "Saving…" : "Save"}
              accessibilityRole="button"
              accessibilityLabel="Save planned route"
              disabled={!canSave}
              onPress={() => setNaming(true)}
            />
          )}
        </View>
        <Text className="text-center text-[13px] text-muted-foreground">
          Routing by{" "}
          <Text
            className="text-primary text-[13px]"
            accessibilityRole="link"
            onPress={() => void Linking.openURL("https://brouter.de/")}
          >
            BRouter
          </Text>{" "}
          · Saved routes work offline
        </Text>
      </View>
      <BRouterProfilePicker visible={choosingProfile} onClose={() => setChoosingProfile(false)} />
      <TextPromptModal
        visible={naming}
        title="Save route"
        placeholder="Route name"
        initialValue="Planned route"
        confirmLabel="Save"
        onCancel={() => {
          if (!useRoutePlannerStore.getState().isSaving) setNaming(false);
        }}
        onSubmit={async (name) => {
          await save(name);
        }}
      />
    </View>
  );
}
