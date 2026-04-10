import React from "react";
import { View, TouchableOpacity, useWindowDimensions } from "react-native";
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { BOTTOM_PANEL_HEIGHT_RATIO } from "@/constants";
import ProfileTabContent from "./ProfileTabContent";
import WeatherPanel from "./WeatherPanel";
import ClimbTabContent from "./ClimbTabContent";
import POITabContent from "./POITabContent";
import type { ActiveRouteData, PanelTab } from "@/types";

const TAB_BAR_HEIGHT = 48;

interface TabDef {
  key: PanelTab;
  label: string;
}

const ALL_TABS: TabDef[] = [
  { key: "profile", label: "Profile" },
  { key: "weather", label: "Weather" },
  { key: "climbs", label: "Climbs" },
  { key: "pois", label: "POIs" },
];

interface TabbedBottomPanelProps {
  activeData: ActiveRouteData | null;
}

export default function TabbedBottomPanel({ activeData }: TabbedBottomPanelProps) {
  const colors = useThemeColors();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const contentAreaHeight = Math.round(screenHeight * BOTTOM_PANEL_HEIGHT_RATIO);
  const panelHeight = contentAreaHeight + safeBottom;

  const panelTab = usePanelStore((s) => s.panelTab);
  const setPanelTab = usePanelStore((s) => s.setPanelTab);

  const contentHeight = contentAreaHeight - TAB_BAR_HEIGHT;

  const keyboard = useAnimatedKeyboard();
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -Math.max(0, keyboard.height.value - safeBottom) }],
  }));

  return (
    <Animated.View
      className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg border-t border-border"
      style={[{ height: panelHeight, backgroundColor: colors.surface }, animatedStyle]}
    >
      {/* Tab bar */}
      <View
        className="flex-row items-center px-2"
        style={{ height: TAB_BAR_HEIGHT, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle }}
      >
        {ALL_TABS.map((tab) => {
          const isActive = panelTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              className="flex-1 items-center justify-center h-full"
              onPress={() => setPanelTab(tab.key)}
              accessibilityLabel={`${tab.label} tab`}
            >
              <Text
                className="text-[13px] font-barlow-semibold"
                style={{ color: isActive ? colors.accent : colors.textTertiary }}
              >
                {tab.label}
              </Text>
              {isActive && (
                <View
                  className="absolute bottom-0 left-3 right-3 rounded-t-sm"
                  style={{ height: 2, backgroundColor: colors.accent }}
                />
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Content — fills remaining space; scrollable tabs handle safe area inset internally */}
      <View className="flex-1">
        {panelTab === "profile" && (
          <ProfileTabContent
            activeData={activeData}
            width={screenWidth}
            height={contentHeight}
          />
        )}
        {panelTab === "weather" && <WeatherPanel />}
        {panelTab === "climbs" && (
          <ClimbTabContent
            activeData={activeData}
          />
        )}
        {panelTab === "pois" && (
          <POITabContent
            activeData={activeData}
          />
        )}
      </View>
    </Animated.View>
  );
}
