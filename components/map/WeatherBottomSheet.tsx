import React from "react";
import { View } from "react-native";
import { useThemeColors } from "@/theme";
import WeatherPanel from "./WeatherPanel";

export default function WeatherBottomSheet() {
  const colors = useThemeColors();

  return (
    <View
      className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg overflow-hidden z-20"
      style={{ backgroundColor: colors.surface }}
    >
      <WeatherPanel />
    </View>
  );
}
