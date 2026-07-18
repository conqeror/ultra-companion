import React, { useEffect, useMemo, useState } from "react";
import { Alert, Linking, Platform, TouchableOpacity, View } from "react-native";
import { Clock3, ExternalLink, Pencil, RefreshCw, Ship, Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useFerryStore } from "@/store/ferryStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useThemeColors } from "@/theme";
import { formatDistance } from "@/utils/formatters";
import { readLinkedEnturFerryStops } from "@/services/enturFerry";
import { ferryDisplayName } from "@/services/ferryCrossings";
import type { FerryCrossing, RouteWithPoints } from "@/types";
import FerryEditorModal from "./FerryEditorModal";

interface RouteFerriesSectionProps {
  route: RouteWithPoints;
}

const EMPTY_FERRIES: FerryCrossing[] = [];

export default function RouteFerriesSection({ route }: RouteFerriesSectionProps) {
  const colors = useThemeColors();
  const units = useSettingsStore((state) => state.units);
  const loadFerries = useFerryStore((state) => state.loadFerries);
  const deleteFerry = useFerryStore((state) => state.deleteFerry);
  const ferries = useFerryStore((state) => state.ferries[route.id] ?? EMPTY_FERRIES);
  const [editorVisible, setEditorVisible] = useState(false);
  const [selected, setSelected] = useState<FerryCrossing | null>(null);
  const [refreshMetadata, setRefreshMetadata] = useState(false);

  useEffect(() => {
    void loadFerries(route.id);
  }, [loadFerries, route.id]);

  const ordered = useMemo(
    () => [...ferries].sort((a, b) => a.startDistanceMeters - b.startDistanceMeters),
    [ferries],
  );

  const openEditor = (crossing: FerryCrossing | null, refresh = false) => {
    setSelected(crossing);
    setRefreshMetadata(refresh);
    setEditorVisible(true);
  };

  const confirmDelete = (crossing: FerryCrossing) => {
    const displayName = ferryDisplayName(crossing);
    const remove = () => void deleteFerry(route.id, crossing.id);
    if (Platform.OS === "web") {
      if (globalThis.confirm?.(`Delete ${displayName}?`)) remove();
      return;
    }
    Alert.alert("Delete ferry?", displayName, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: remove },
    ]);
  };

  return (
    <View className="mx-4 mt-4 rounded-xl border border-border bg-card p-4">
      <View className="mb-3 flex-row items-center justify-between gap-3">
        <View className="flex-1 flex-row items-center gap-2">
          <Ship size={21} color={colors.info} />
          <Text className="text-[20px] font-barlow-semibold text-foreground">Ferries</Text>
        </View>
        <Button
          size="sm"
          variant="secondary"
          label="Add ferry"
          onPress={() => openEditor(null)}
          accessibilityLabel="Add ferry"
        />
      </View>

      {ordered.length === 0 ? (
        <Text className="text-[14px] leading-5 text-muted-foreground">
          Mark a known crossing to exclude its water distance and add it to Upcoming.
        </Text>
      ) : (
        <View className="gap-3">
          {ordered.map((crossing) => (
            <View key={crossing.id} className="rounded-xl border border-border bg-background p-3">
              <View className="flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-[16px] font-barlow-semibold text-foreground">
                    {ferryDisplayName(crossing)}
                  </Text>
                  <Text className="mt-1 text-[13px] text-muted-foreground">
                    {formatDistance(crossing.startDistanceMeters, units)} ·{" "}
                    {formatDistance(
                      crossing.endDistanceMeters - crossing.startDistanceMeters,
                      units,
                    )}{" "}
                    excluded
                  </Text>
                  <View className="mt-2 flex-row items-center gap-1.5">
                    <Clock3 size={14} color={colors.textSecondary} />
                    <Text className="text-[13px] text-muted-foreground">
                      {crossing.durationMinutes} min crossing · {crossing.assumedWaitMinutes} min
                      assumed wait
                    </Text>
                  </View>
                  <Text className="mt-1 text-[12px] text-muted-foreground">
                    {crossing.source === "osm" ? "OSM metadata" : "Manual"}
                    {readLinkedEnturFerryStops(crossing.providerRefs) ? " · Entur linked" : ""} ·
                    updated {new Date(crossing.updatedAt).toLocaleDateString()}
                  </Text>
                </View>
                <TouchableOpacity
                  className="h-[48px] w-[48px] items-center justify-center"
                  onPress={() => openEditor(crossing)}
                  accessibilityLabel={`Edit ferry ${ferryDisplayName(crossing)}`}
                >
                  <Pencil size={19} color={colors.accent} />
                </TouchableOpacity>
              </View>
              <View className="mt-2 flex-row gap-2">
                {crossing.timetableUrl && (
                  <TouchableOpacity
                    className="min-h-[48px] flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border"
                    onPress={() => void Linking.openURL(crossing.timetableUrl!)}
                    accessibilityLabel={`Open timetable for ${ferryDisplayName(crossing)}`}
                  >
                    <ExternalLink size={17} color={colors.accent} />
                    <Text className="font-barlow-medium text-primary">Timetable</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  className="min-h-[48px] flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-border"
                  onPress={() => openEditor(crossing, true)}
                  accessibilityLabel={`Refresh ferry ${ferryDisplayName(crossing)}`}
                >
                  <RefreshCw size={17} color={colors.accent} />
                  <Text className="font-barlow-medium text-primary">Refresh metadata</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className="h-[48px] w-[48px] items-center justify-center rounded-xl border border-border"
                  onPress={() => confirmDelete(crossing)}
                  accessibilityLabel={`Delete ferry ${ferryDisplayName(crossing)}`}
                >
                  <Trash2 size={18} color={colors.destructive} />
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <FerryEditorModal
        visible={editorVisible}
        route={route}
        crossing={selected}
        refreshMetadata={refreshMetadata}
        onClose={() => {
          setEditorVisible(false);
          setSelected(null);
          setRefreshMetadata(false);
        }}
      />
    </View>
  );
}
