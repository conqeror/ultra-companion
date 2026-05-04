import React, { useState } from "react";
import { TouchableOpacity, View, useWindowDimensions } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { Text } from "@/components/ui/text";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import { PANEL_MODES } from "@/constants";
import { ridingHorizonKmLabelForMode, ridingHorizonLabelForMode } from "@/utils/ridingHorizon";

export const RIDING_HORIZON_SELECTOR_HEIGHT = 48;
export const RIDING_HORIZON_SELECTOR_GAP = 8;
export const RIDING_HORIZON_SELECTOR_OFFSET =
  RIDING_HORIZON_SELECTOR_HEIGHT + RIDING_HORIZON_SELECTOR_GAP;

const HORIZONTAL_MARGIN = 12;
const COLLAPSED_WIDTH = 88;
const SURFACE_ALPHA = 0.96;
const FLOATING_SURFACE_STYLE = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.12,
  shadowRadius: 10,
  elevation: 4,
};

function withAlpha(hex: string, alpha: number): string {
  const normalized = hex.replace("#", "");
  const value = Number.parseInt(normalized, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export default function RidingHorizonSelector() {
  const colors = useThemeColors();
  const { width: screenWidth } = useWindowDimensions();
  const panelMode = usePanelStore((s) => s.panelMode);
  const setPanelMode = usePanelStore((s) => s.setPanelMode);
  const [isOpen, setIsOpen] = useState(false);
  const openProgress = useSharedValue(0);

  const selectedLabel = ridingHorizonLabelForMode(panelMode);
  const expandedWidth = Math.max(COLLAPSED_WIDTH, screenWidth - HORIZONTAL_MARGIN * 2);

  const selectorStyle = useAnimatedStyle(() => ({
    width: COLLAPSED_WIDTH + (expandedWidth - COLLAPSED_WIDTH) * openProgress.value,
  }));

  const collapsedLayerStyle = useAnimatedStyle(() => ({
    opacity: 1 - openProgress.value,
    transform: [{ scale: 1 - openProgress.value * 0.04 }],
  }));

  const expandedLayerStyle = useAnimatedStyle(() => ({
    opacity: openProgress.value,
    transform: [{ translateX: (1 - openProgress.value) * 10 }],
  }));

  const open = () => {
    setIsOpen(true);
    openProgress.value = withTiming(1, {
      duration: 220,
      easing: Easing.out(Easing.cubic),
    });
  };

  const close = () => {
    setIsOpen(false);
    openProgress.value = withTiming(0, {
      duration: 170,
      easing: Easing.inOut(Easing.quad),
    });
  };

  return (
    <View
      style={{
        position: "absolute",
        right: HORIZONTAL_MARGIN,
        top: 0,
        zIndex: 20,
      }}
    >
      <Animated.View
        className="rounded-full border border-border"
        style={[
          {
            backgroundColor: withAlpha(colors.surface, SURFACE_ALPHA),
            borderColor: withAlpha(colors.borderSubtle, 0.95),
            height: RIDING_HORIZON_SELECTOR_HEIGHT,
            overflow: "hidden",
            ...FLOATING_SURFACE_STYLE,
          },
          selectorStyle,
        ]}
      >
        <Animated.View
          className="absolute inset-y-0 right-0"
          pointerEvents={isOpen ? "none" : "auto"}
          accessibilityElementsHidden={isOpen}
          importantForAccessibility={isOpen ? "no-hide-descendants" : "auto"}
          style={[
            {
              width: COLLAPSED_WIDTH,
            },
            collapsedLayerStyle,
          ]}
        >
          <TouchableOpacity
            className="h-full w-full flex-row items-center justify-center px-4"
            onPress={open}
            accessibilityLabel={`Riding horizon ${selectedLabel}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: false }}
            activeOpacity={0.75}
          >
            <Text className="font-barlow-sc-semibold text-[15px]" style={{ color: colors.accent }}>
              {selectedLabel}
            </Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View
          className="absolute inset-y-0 right-0 flex-row items-center"
          pointerEvents={isOpen ? "auto" : "none"}
          accessibilityElementsHidden={!isOpen}
          importantForAccessibility={isOpen ? "auto" : "no-hide-descendants"}
          style={[
            {
              width: expandedWidth,
              padding: 2,
              gap: 4,
            },
            expandedLayerStyle,
          ]}
        >
          {PANEL_MODES.map((mode) => {
            const isActive = mode === panelMode;
            const km = ridingHorizonKmLabelForMode(mode);
            return (
              <TouchableOpacity
                key={mode}
                onPress={() => {
                  setPanelMode(mode);
                  close();
                }}
                hitSlop={{ left: 2, right: 2 }}
                accessibilityLabel={`Set riding horizon to ${ridingHorizonLabelForMode(mode)}`}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                className="flex-1 rounded-full items-center justify-center"
                style={{
                  minWidth: 44,
                  height: 44,
                  backgroundColor: isActive ? colors.accent : "transparent",
                }}
                activeOpacity={0.78}
              >
                <Text
                  className="font-barlow-sc-semibold text-[13px]"
                  style={{
                    color: isActive ? colors.accentForeground : colors.textSecondary,
                  }}
                >
                  {km}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
