import React, { useMemo } from "react";
import { View, TouchableOpacity, ScrollView } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { X, MapPin, Clock, Phone } from "lucide-react-native";
import {
  Droplets,
  ShoppingCart,
  Fuel,
  Coffee,
  Bed,
  Wrench,
  Banknote,
  Cross,
  ShowerHead,
} from "lucide-react-native";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useRouteStore } from "@/store/routeStore";
import { usePoiStore } from "@/store/poiStore";
import { POI_CATEGORIES } from "@/constants";
import { formatDistance } from "@/utils/formatters";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  Droplets,
  ShoppingCart,
  Fuel,
  Coffee,
  Bed,
  Wrench,
  Banknote,
  Cross,
  ShowerHead,
};

function parseOpeningHours(value: string): string {
  try {
    // Dynamic import to avoid crash if package has issues
    const OpeningHours = require("opening_hours");
    const oh = new OpeningHours(value);
    const isOpen = oh.getState();
    const nextChange = oh.getNextChange();

    let status = isOpen ? "Open" : "Closed";
    if (nextChange) {
      const time = nextChange.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      status += isOpen ? ` · closes ${time}` : ` · opens ${time}`;
    }
    return status;
  } catch {
    return value;
  }
}

export default function POIDetailSheet() {
  const colors = useThemeColors();
  const units = useSettingsStore((s) => s.units);
  const snappedPosition = useRouteStore((s) => s.snappedPosition);
  const selectedPOI = usePoiStore((s) => s.selectedPOI);
  const setSelectedPOI = usePoiStore((s) => s.setSelectedPOI);

  const isVisible = selectedPOI != null;

  const catMeta = useMemo(
    () =>
      selectedPOI
        ? POI_CATEGORIES.find((c) => c.key === selectedPOI.category)
        : null,
    [selectedPOI],
  );

  const IconComp = catMeta ? ICON_MAP[catMeta.iconName] : null;

  const distAhead = useMemo(() => {
    if (!selectedPOI || !snappedPosition) return null;
    return (
      selectedPOI.distanceAlongRouteMeters -
      snappedPosition.distanceAlongRouteMeters
    );
  }, [selectedPOI, snappedPosition]);

  const openingHoursRaw = selectedPOI?.tags?.opening_hours;
  const openingHoursDisplay = useMemo(
    () => (openingHoursRaw ? parseOpeningHours(openingHoursRaw) : null),
    [openingHoursRaw],
  );

  const address = useMemo(() => {
    if (!selectedPOI) return null;
    const t = selectedPOI.tags;
    const parts: string[] = [];
    if (t["addr:street"]) {
      const num = t["addr:housenumber"] ? ` ${t["addr:housenumber"]}` : "";
      parts.push(`${t["addr:street"]}${num}`);
    }
    if (t["addr:city"]) parts.push(t["addr:city"]);
    return parts.length > 0 ? parts.join(", ") : null;
  }, [selectedPOI]);

  const phone =
    selectedPOI?.tags?.phone ?? selectedPOI?.tags?.["contact:phone"] ?? null;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(isVisible ? 0 : 400, {
          duration: 250,
          easing: Easing.out(Easing.cubic),
        }),
      },
    ],
  }));

  if (!isVisible) return null;

  return (
    <Animated.View
      className="absolute bottom-0 left-0 right-0 bg-surface rounded-t-2xl shadow-lg z-20"
      style={[{ maxHeight: "45%" }, animatedStyle]}
    >
      {/* Header */}
      <View className="flex-row items-start px-4 pt-4 pb-2">
        <View className="flex-1">
          <Text
            className="text-[20px] font-barlow-semibold text-foreground"
            numberOfLines={2}
          >
            {selectedPOI.name ?? catMeta?.label ?? "Unnamed"}
          </Text>

          {/* Category badge */}
          <View className="flex-row items-center mt-2">
            {IconComp && (
              <IconComp
                size={14}
                color={catMeta?.color ?? colors.textPrimary}
              />
            )}
            <Text
              className="ml-1.5 text-[13px] font-barlow-medium"
              style={{ color: catMeta?.color ?? colors.textSecondary }}
            >
              {catMeta?.label}
            </Text>
          </View>
        </View>

        {/* Close button */}
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center -mr-2 -mt-2"
          onPress={() => setSelectedPOI(null)}
          accessibilityLabel="Close"
        >
          <X size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      <ScrollView className="px-4 pb-4">
        {/* Distance info */}
        <View className="flex-row items-center mt-2">
          <MapPin size={15} color={colors.textSecondary} />
          <Text className="ml-2 text-[14px] text-muted-foreground font-barlow">
            {Math.round(selectedPOI.distanceFromRouteMeters)} m off route
          </Text>
          {distAhead != null && (
            <Text className="ml-3 text-[14px] font-barlow-sc-semibold text-foreground">
              {distAhead >= 0
                ? `${formatDistance(distAhead, units)} ahead`
                : `${formatDistance(Math.abs(distAhead), units)} behind`}
            </Text>
          )}
        </View>

        {/* Opening hours */}
        {openingHoursDisplay && (
          <View className="flex-row items-center mt-3">
            <Clock size={15} color={colors.textSecondary} />
            <Text
              className="ml-2 text-[14px] font-barlow"
              style={{
                color: openingHoursDisplay.startsWith("Open")
                  ? colors.positive
                  : openingHoursDisplay.startsWith("Closed")
                    ? colors.destructive
                    : colors.textSecondary,
              }}
            >
              {openingHoursDisplay}
            </Text>
          </View>
        )}

        {/* Address */}
        {address && (
          <View className="flex-row items-center mt-3">
            <MapPin size={15} color={colors.textSecondary} />
            <Text className="ml-2 text-[14px] text-muted-foreground font-barlow">
              {address}
            </Text>
          </View>
        )}

        {/* Phone */}
        {phone && (
          <View className="flex-row items-center mt-3 mb-4">
            <Phone size={15} color={colors.textSecondary} />
            <Text className="ml-2 text-[14px] text-muted-foreground font-barlow">
              {phone}
            </Text>
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}
