import React, { useState, useMemo, useCallback } from "react";
import { View, TouchableOpacity, ScrollView, TextInput } from "react-native";
import { Text } from "@/components/ui/text";
import { ChevronDown, ChevronUp } from "lucide-react-native";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useSettingsStore } from "@/store/settingsStore";
import { useEtaStore } from "@/store/etaStore";
import { usePoiStore } from "@/store/poiStore";
import { solveVelocity } from "@/services/powerModel";
import type { UnitSystem } from "@/types";
import StorageSection from "@/components/offline/StorageSection";

const UNIT_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: "metric", label: "Metric (km)" },
  { value: "imperial", label: "Imperial (mi)" },
];

const CORRIDOR_OPTIONS: { value: string; label: string }[] = [
  { value: "500", label: "500 m" },
  { value: "1000", label: "1 km" },
  { value: "2000", label: "2 km" },
  { value: "5000", label: "5 km" },
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

function NumericInput({
  label,
  value,
  unit,
  onChangeValue,
}: {
  label: string;
  value: number;
  unit: string;
  onChangeValue: (v: number) => void;
}) {
  const colors = useThemeColors();
  const [text, setText] = useState(String(value));

  const handleBlur = useCallback(() => {
    const parsed = parseFloat(text);
    if (!isNaN(parsed) && parsed > 0) {
      onChangeValue(parsed);
    } else {
      setText(String(value));
    }
  }, [text, value, onChangeValue]);

  return (
    <View className="flex-row items-center justify-between py-3">
      <Text className="text-[15px] font-barlow text-foreground">{label}</Text>
      <View className="flex-row items-center">
        <TextInput
          className="text-[15px] font-barlow-sc-semibold text-foreground text-right min-w-[60px] px-2 py-1 bg-card rounded-lg"
          style={{ color: colors.textPrimary }}
          value={text}
          onChangeText={setText}
          onBlur={handleBlur}
          keyboardType="decimal-pad"
          returnKeyType="done"
          selectTextOnFocus
        />
        <Text className="text-[13px] text-muted-foreground font-barlow ml-1 w-[30px]">
          {unit}
        </Text>
      </View>
    </View>
  );
}

export default function SettingsScreen() {
  const { units, setUnits } = useSettingsStore();
  const colors = useThemeColors();
  const powerConfig = useEtaStore((s) => s.powerConfig);
  const updatePowerConfig = useEtaStore((s) => s.updatePowerConfig);
  const corridorWidthM = usePoiStore((s) => s.corridorWidthM);
  const setCorridorWidth = usePoiStore((s) => s.setCorridorWidth);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const flatSpeedKmh = useMemo(() => {
    const v = solveVelocity(0, powerConfig);
    return (v * 3.6).toFixed(0);
  }, [powerConfig]);

  return (
    <ScrollView className="flex-1 bg-background px-4">
      <Text className="text-[22px] font-barlow-semibold text-foreground mt-6 mb-3">
        Units
      </Text>
      <OptionGroup options={UNIT_OPTIONS} value={units} onChange={setUnits} />

      <Text className="text-[22px] font-barlow-semibold text-foreground mt-6 mb-3">
        POI Search Radius
      </Text>
      <OptionGroup
        options={CORRIDOR_OPTIONS}
        value={String(corridorWidthM)}
        onChange={(v) => setCorridorWidth(Number(v))}
      />

      <Text className="text-[22px] font-barlow-semibold text-foreground mt-8 mb-1">
        ETA Calculator
      </Text>
      <Text className="text-[13px] text-muted-foreground font-barlow mb-3">
        Flat speed ~{flatSpeedKmh} km/h
      </Text>

      <View className="bg-card rounded-xl px-4">
        <NumericInput
          label="Power"
          value={powerConfig.powerWatts}
          unit="W"
          onChangeValue={(v) => updatePowerConfig({ powerWatts: v })}
        />
        <View className="border-b border-border" />
        <NumericInput
          label="Total weight"
          value={powerConfig.totalMassKg}
          unit="kg"
          onChangeValue={(v) => updatePowerConfig({ totalMassKg: v })}
        />
      </View>

      {/* Advanced settings */}
      <TouchableOpacity
        className="flex-row items-center mt-4 py-2"
        onPress={() => setShowAdvanced(!showAdvanced)}
      >
        <Text className="text-[14px] font-barlow-medium text-muted-foreground">
          Advanced
        </Text>
        {showAdvanced ? (
          <ChevronUp size={16} color={colors.textSecondary} />
        ) : (
          <ChevronDown size={16} color={colors.textSecondary} />
        )}
      </TouchableOpacity>

      {showAdvanced && (
        <View className="bg-card rounded-xl px-4 mb-2">
          <NumericInput
            label="CdA"
            value={powerConfig.cda}
            unit="m²"
            onChangeValue={(v) => updatePowerConfig({ cda: v })}
          />
          <View className="border-b border-border" />
          <NumericInput
            label="Crr"
            value={powerConfig.crr}
            unit=""
            onChangeValue={(v) => updatePowerConfig({ crr: v })}
          />
          <View className="border-b border-border" />
          <NumericInput
            label="Max descent"
            value={powerConfig.maxDescentSpeedKmh}
            unit="km/h"
            onChangeValue={(v) => updatePowerConfig({ maxDescentSpeedKmh: v })}
          />
          <View className="border-b border-border" />
          <NumericInput
            label="Drivetrain eff."
            value={powerConfig.drivetrainEfficiency}
            unit=""
            onChangeValue={(v) => updatePowerConfig({ drivetrainEfficiency: v })}
          />
        </View>
      )}

      <StorageSection />

      {/* Bottom spacer */}
      <View className="h-12" />
    </ScrollView>
  );
}
