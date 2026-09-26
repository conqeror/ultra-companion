import React, { useEffect, useMemo, useState } from "react";
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
import { cn } from "@/lib/cn";
import { ChevronDown } from "lucide-react-native";
import BRouterProfilePicker from "@/components/route/BRouterProfilePicker";
import RouteComparisonPanel from "@/components/route/RouteComparisonPanel";
import { useBRouterProfileStore } from "@/store/brouterProfileStore";

export default function RoutePlannerScreen() {
  const planner = useRoutePlannerStore();
  const {
    waypoints,
    selectedProfileIds,
    setSelectedProfileIds,
    candidates,
    selectedCandidateId,
    selectCandidate,
    loadingProfileIds,
    alternativeLoadingProfileIds,
    loadedAlternativeProfileIds,
    profileErrors,
    alternativeErrors,
    error,
    isRouting,
    isSaving,
    savedRoute,
    addWaypoint,
    undo,
    reset,
    calculate,
    loadAlternatives,
    save,
  } = planner;
  const savedProfiles = useBRouterProfileStore((state) => state.profiles);
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
  }, [waypoints, selectedProfileIds, calculate]);

  useEffect(() => () => reset(), [reset]);

  useEffect(() => {
    if (savedRoute && !isSaving) {
      router.replace({ pathname: "/route/[id]", params: { id: savedRoute.id } });
    }
  }, [savedRoute, isSaving, router]);

  const canSave =
    selectedCandidateId != null &&
    !isRouting &&
    !isSaving &&
    alternativeLoadingProfileIds.length === 0;
  const canEdit = waypoints.length > 0 && !isSaving;
  const profileLabel = useMemo(() => {
    const names = selectedProfileIds.map(
      (profileId) =>
        savedProfiles.find((profile) => profile.id === profileId)?.name ?? "Road cycling",
    );
    return names.length === 1 ? names[0] : `${names.length} profiles`;
  }, [savedProfiles, selectedProfileIds]);
  const hasRoutingErrors = Object.values(profileErrors).some(Boolean);
  const firstRoutingError = Object.values(profileErrors).find(Boolean);
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
        candidates={candidates}
        selectedCandidateId={selectedCandidateId}
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
              accessibilityLabel={`Compare routing profiles: ${profileLabel}`}
              onPress={() => setChoosingProfile(true)}
            >
              <Text
                numberOfLines={1}
                className="flex-1 text-[15px] font-barlow-semibold text-primary"
              >
                {profileLabel}
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
          {isRouting || (waypoints.length >= 2 && candidates.length === 0 && !hasRoutingErrors) ? (
            <View
              className="flex-row items-center gap-2"
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Calculating route"
            >
              <ActivityIndicator color={colors.accent} />
              <Text className="text-[17px] text-foreground">
                Calculating{" "}
                {loadingProfileIds.length > 0
                  ? loadingProfileIds.length
                  : selectedProfileIds.length}{" "}
                {selectedProfileIds.length === 1 ? "route" : "routes"}…
              </Text>
            </View>
          ) : null}
          {(error || (candidates.length === 0 ? firstRoutingError : null)) && (
            <Text accessibilityRole="alert" className="text-[15px] text-destructive">
              {error ?? firstRoutingError}
            </Text>
          )}
        </View>
        {candidates.length > 0 && (
          <RouteComparisonPanel
            candidates={candidates}
            selectedCandidateId={selectedCandidateId}
            profileErrors={profileErrors}
            alternativeErrors={alternativeErrors}
            alternativeLoadingProfileIds={alternativeLoadingProfileIds}
            loadedAlternativeProfileIds={loadedAlternativeProfileIds}
            units={units}
            onSelect={selectCandidate}
            onLoadAlternatives={(profileId) => void loadAlternatives(profileId)}
            onRetryFailedProfiles={() => void calculate()}
          />
        )}
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
          {(error || hasRoutingErrors) && candidates.length === 0 ? (
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
      <BRouterProfilePicker
        visible={choosingProfile}
        selectedProfileIds={selectedProfileIds}
        onChange={setSelectedProfileIds}
        onClose={() => setChoosingProfile(false)}
      />
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
