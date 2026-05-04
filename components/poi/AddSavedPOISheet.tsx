import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Constants from "expo-constants";
import { X } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { POI_CATEGORIES } from "@/constants";
import { POI_ICON_MAP } from "@/constants/poiIcons";
import { usePoiStore } from "@/store/poiStore";
import { useThemeColors } from "@/theme";
import {
  buildSavedPOI,
  findNearestSavedPOITarget,
  resolveGoogleMapsLink,
  type SavedPOITarget,
} from "@/services/savedPOIService";
import type { POI, POICategory } from "@/types";

interface AddSavedPOISheetProps {
  visible: boolean;
  title?: string;
  targets: SavedPOITarget[];
  onClose: () => void;
  onSaved?: (poi: POI) => void;
}

const DEFAULT_CATEGORY: POICategory = "other";

function formatCoordinate(value: number | null): string {
  return value == null ? "" : String(Number(value.toFixed(7)));
}

function parseCoordinate(value: string): number | null {
  const n = Number(value.trim());
  return Number.isFinite(n) ? n : null;
}

function isValidLatitude(value: number | null): value is number {
  return value != null && Math.abs(value) <= 90;
}

function isValidLongitude(value: number | null): value is number {
  return value != null && Math.abs(value) <= 180;
}

export default function AddSavedPOISheet({
  visible,
  title = "Add POI",
  targets,
  onClose,
  onSaved,
}: AddSavedPOISheetProps) {
  const colors = useThemeColors();
  const addCustomPOI = usePoiStore((s) => s.addCustomPOI);

  const [mapsUrl, setMapsUrl] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState<POICategory>(DEFAULT_CATEGORY);
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [notes, setNotes] = useState("");
  const [tags, setTags] = useState<Record<string, string>>({});
  const [sourceId, setSourceId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const apiKey = Constants.expoConfig?.extra?.googlePlacesApiKey as string | undefined;
  const canSave = useMemo(() => {
    const lat = parseCoordinate(latitude);
    const lon = parseCoordinate(longitude);
    return isValidLatitude(lat) && isValidLongitude(lon) && targets.length > 0 && !isSaving;
  }, [latitude, longitude, targets.length, isSaving]);

  useEffect(() => {
    if (!visible) return;
    setMapsUrl("");
    setName("");
    setCategory(DEFAULT_CATEGORY);
    setLatitude("");
    setLongitude("");
    setNotes("");
    setTags({});
    setSourceId(undefined);
    setError(null);
    setIsResolving(false);
    setIsSaving(false);
  }, [visible]);

  const handleResolve = useCallback(async () => {
    if (!mapsUrl.trim()) {
      setError("Paste a Google Maps link first.");
      return;
    }

    setIsResolving(true);
    setError(null);
    try {
      const resolved = await resolveGoogleMapsLink(mapsUrl, apiKey);
      setMapsUrl(resolved.resolvedUrl);
      setTags(resolved.tags);
      setSourceId(resolved.sourceId);
      setCategory(resolved.category);
      if (resolved.name) setName(resolved.name);
      if (resolved.latitude != null) setLatitude(formatCoordinate(resolved.latitude));
      if (resolved.longitude != null) setLongitude(formatCoordinate(resolved.longitude));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not resolve this link.");
    } finally {
      setIsResolving(false);
    }
  }, [apiKey, mapsUrl]);

  const handleSave = useCallback(async () => {
    const lat = parseCoordinate(latitude);
    const lon = parseCoordinate(longitude);
    if (!isValidLatitude(lat) || !isValidLongitude(lon)) {
      setError("Enter valid latitude and longitude.");
      return;
    }

    const nearest = findNearestSavedPOITarget(lat, lon, targets);
    if (!nearest) {
      setError("No route segment is available.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      const poi = buildSavedPOI(
        {
          name: name.trim() || null,
          category,
          latitude: lat,
          longitude: lon,
          notes,
          tags: {
            ...tags,
            ...(mapsUrl.trim() ? { google_maps_url: mapsUrl.trim() } : {}),
          },
          sourceId,
        },
        nearest.target,
      );
      await addCustomPOI(poi);
      onSaved?.(poi);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this POI.");
    } finally {
      setIsSaving(false);
    }
  }, [
    addCustomPOI,
    category,
    latitude,
    longitude,
    mapsUrl,
    name,
    notes,
    onClose,
    onSaved,
    sourceId,
    tags,
    targets,
  ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 bg-background"
      >
        <View
          className="flex-row items-center justify-between px-4 pt-4 pb-3"
          style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          <Text className="text-[22px] font-barlow-semibold text-foreground">{title}</Text>
          <TouchableOpacity
            className="w-[48px] h-[48px] items-center justify-center"
            onPress={onClose}
            accessibilityLabel="Close Add POI"
          >
            <X size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 28 }}
          keyboardShouldPersistTaps="handled"
        >
          <InputLabel label="Google Maps link" />
          <View className="flex-row gap-2 mb-4">
            <TextInput
              className="flex-1 min-h-[52px] px-3 rounded-xl border border-border bg-card text-foreground font-barlow text-[15px]"
              placeholder="https://maps.app.goo.gl/..."
              placeholderTextColor={colors.textTertiary}
              value={mapsUrl}
              onChangeText={setMapsUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Google Maps link"
            />
            <Button
              size="sm"
              variant="secondary"
              className="min-h-[52px]"
              disabled={isResolving}
              onPress={handleResolve}
              label={isResolving ? undefined : "Resolve"}
            >
              {isResolving && <ActivityIndicator color={colors.accent} />}
            </Button>
          </View>

          <InputLabel label="Name" />
          <TextInput
            className="min-h-[52px] px-3 rounded-xl border border-border bg-card text-foreground font-barlow text-[15px] mb-4"
            placeholder="Place name"
            placeholderTextColor={colors.textTertiary}
            value={name}
            onChangeText={setName}
            accessibilityLabel="POI name"
          />

          <InputLabel label="Category" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingBottom: 16 }}
          >
            {POI_CATEGORIES.map((cat) => {
              const Icon = POI_ICON_MAP[cat.iconName];
              const selected = category === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  className={cn(
                    "flex-row items-center min-h-[48px] px-3 rounded-full border",
                    selected ? "bg-muted border-border" : "border-transparent",
                  )}
                  onPress={() => setCategory(cat.key)}
                  accessibilityLabel={`Set category ${cat.label}`}
                >
                  {Icon && <Icon size={14} color={selected ? cat.color : colors.textTertiary} />}
                  <Text
                    className={cn(
                      "ml-1 text-[13px] font-barlow-medium",
                      selected ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {cat.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          <View className="flex-row gap-3 mb-4">
            <View className="flex-1">
              <InputLabel label="Latitude" />
              <TextInput
                className="min-h-[52px] px-3 rounded-xl border border-border bg-card text-foreground font-barlow-sc-medium text-[16px]"
                placeholder="48.2082"
                placeholderTextColor={colors.textTertiary}
                value={latitude}
                onChangeText={setLatitude}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Latitude"
              />
            </View>
            <View className="flex-1">
              <InputLabel label="Longitude" />
              <TextInput
                className="min-h-[52px] px-3 rounded-xl border border-border bg-card text-foreground font-barlow-sc-medium text-[16px]"
                placeholder="16.3738"
                placeholderTextColor={colors.textTertiary}
                value={longitude}
                onChangeText={setLongitude}
                keyboardType="numbers-and-punctuation"
                accessibilityLabel="Longitude"
              />
            </View>
          </View>

          <InputLabel label="Notes" />
          <TextInput
            className="min-h-[96px] px-3 py-3 rounded-xl border border-border bg-card text-foreground font-barlow text-[15px] mb-4"
            placeholder="24/7, good toilets, bike visible..."
            placeholderTextColor={colors.textTertiary}
            value={notes}
            onChangeText={setNotes}
            multiline
            textAlignVertical="top"
            accessibilityLabel="POI notes"
          />

          {error && <Text className="text-[13px] text-destructive font-barlow mb-3">{error}</Text>}

          <Button
            disabled={!canSave}
            onPress={handleSave}
            label={isSaving ? undefined : "Save POI"}
          >
            {isSaving && <ActivityIndicator color="#fff" />}
          </Button>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function InputLabel({ label }: { label: string }) {
  return (
    <Text className="text-[13px] font-barlow-semibold text-muted-foreground mb-1.5">{label}</Text>
  );
}
