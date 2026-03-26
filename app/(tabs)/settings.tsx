import React from "react";
import { View, TouchableOpacity, ScrollView } from "react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { useSettingsStore } from "@/store/settingsStore";
import type { UnitSystem, MapStyle } from "@/types";

const UNIT_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: "metric", label: "Metric (km)" },
  { value: "imperial", label: "Imperial (mi)" },
];

const MAP_STYLE_OPTIONS: { value: MapStyle; label: string }[] = [
  { value: "streets", label: "Streets" },
  { value: "outdoors", label: "Outdoors" },
  { value: "satellite", label: "Satellite" },
];

function OptionGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View className="gap-2">
      {options.map((option) => (
        <TouchableOpacity
          key={option.value}
          className={cn(
            "min-h-[52px] px-4 py-3 rounded-xl justify-center",
            value === option.value ? "bg-primary/10" : "bg-card",
          )}
          onPress={() => onChange(option.value)}
        >
          <Text
            className={cn(
              "text-base",
              value === option.value
                ? "text-primary font-barlow-semibold"
                : "text-foreground font-barlow",
            )}
          >
            {option.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const { units, mapStyle, setUnits, setMapStyle } = useSettingsStore();

  return (
    <ScrollView className="flex-1 bg-background px-4">
      <Text className="text-[22px] font-barlow-semibold text-foreground mt-6 mb-3">
        Units
      </Text>
      <OptionGroup options={UNIT_OPTIONS} value={units} onChange={setUnits} />

      <Text className="text-[22px] font-barlow-semibold text-foreground mt-6 mb-3">
        Map Style
      </Text>
      <OptionGroup options={MAP_STYLE_OPTIONS} value={mapStyle} onChange={setMapStyle} />
    </ScrollView>
  );
}
