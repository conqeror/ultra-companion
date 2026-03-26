import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from "react-native";
import { useSettingsStore } from "@/store/settingsStore";
import type { UnitSystem, MapStyle } from "@/types";
import { MIN_TOUCH_TARGET } from "@/constants";

const UNIT_OPTIONS: { value: UnitSystem; label: string }[] = [
  { value: "metric", label: "Metric (km)" },
  { value: "imperial", label: "Imperial (mi)" },
];

const MAP_STYLE_OPTIONS: { value: MapStyle; label: string }[] = [
  { value: "streets", label: "Streets" },
  { value: "outdoors", label: "Outdoors" },
  { value: "satellite", label: "Satellite" },
];

export default function SettingsScreen() {
  const { units, mapStyle, setUnits, setMapStyle } = useSettingsStore();

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>Units</Text>
      <View style={styles.optionGroup}>
        {UNIT_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.option,
              units === option.value && styles.optionActive,
            ]}
            onPress={() => setUnits(option.value)}
          >
            <Text
              style={[
                styles.optionText,
                units === option.value && styles.optionTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Map Style</Text>
      <View style={styles.optionGroup}>
        {MAP_STYLE_OPTIONS.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.option,
              mapStyle === option.value && styles.optionActive,
            ]}
            onPress={() => setMapStyle(option.value)}
          >
            <Text
              style={[
                styles.optionText,
                mapStyle === option.value && styles.optionTextActive,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#fff",
    padding: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#333",
    marginTop: 24,
    marginBottom: 12,
  },
  optionGroup: {
    gap: 8,
  },
  option: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#F2F2F7",
    justifyContent: "center",
  },
  optionActive: {
    backgroundColor: "#007AFF",
  },
  optionText: {
    fontSize: 16,
    color: "#333",
  },
  optionTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
});
