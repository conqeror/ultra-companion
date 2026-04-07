import React from "react";
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { useThemeColors } from "@/theme";
import WeatherPanel from "./WeatherPanel";

export default function WeatherBottomSheet() {
  const colors = useThemeColors();

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(0, {
          duration: 250,
          easing: Easing.out(Easing.cubic),
        }),
      },
    ],
  }));

  return (
    <Animated.View
      className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg overflow-hidden z-20"
      style={[{ backgroundColor: colors.surface }, animatedStyle]}
    >
      <WeatherPanel />
    </Animated.View>
  );
}
