import React from "react";
import { View, TouchableOpacity } from "react-native";
import Animated, {
  useAnimatedStyle,
  withTiming,
  Easing,
} from "react-native-reanimated";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import WeatherPanel from "./WeatherPanel";

interface WeatherBottomSheetProps {
  onClose: () => void;
}

export default function WeatherBottomSheet({ onClose }: WeatherBottomSheetProps) {
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
      <View className="flex-row items-center justify-end px-2">
        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center"
          onPress={onClose}
          accessibilityLabel="Close weather"
        >
          <X size={20} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <WeatherPanel />
    </Animated.View>
  );
}
