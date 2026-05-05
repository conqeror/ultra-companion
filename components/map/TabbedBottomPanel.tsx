import React from "react";
import { View, TouchableOpacity, useWindowDimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedKeyboard,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { usePanelStore } from "@/store/panelStore";
import { SHEET_COMPACT_RATIO, SHEET_EXPANDED_RATIO } from "@/constants";
import ProfileTabContent from "./ProfileTabContent";
import UpcomingTabContent from "./UpcomingTabContent";
import WeatherPanel from "./WeatherPanel";
import ClimbTabContent from "./ClimbTabContent";
import POITabContent from "./POITabContent";
import RidingHorizonSelector, { RIDING_HORIZON_SELECTOR_OFFSET } from "./RidingHorizonSelector";
import type { ActiveRouteData, PanelTab } from "@/types";

/** Combined handle + tabs height */
const HEADER_HEIGHT = 52;

/** No bounce — clamp at snap points */
const SPRING_CONFIG = { damping: 28, stiffness: 300, overshootClamping: true };

/** Velocity threshold — fast flick snaps in the flick direction */
const VELOCITY_THRESHOLD = 500;

interface TabDef {
  key: PanelTab;
  label: string;
}

const ALL_TABS: TabDef[] = [
  { key: "profile", label: "Profile" },
  { key: "upcoming", label: "Upcoming" },
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
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const compactHeight = Math.round(screenHeight * SHEET_COMPACT_RATIO) + safeBottom;
  const expandedHeight = Math.round(screenHeight * SHEET_EXPANDED_RATIO) + safeBottom;

  // The View is expandedHeight tall, positioned at bottom: 0.
  // translateY pushes it down: compactOffset shows only compactHeight, 0 shows full expandedHeight.
  const compactOffset = expandedHeight - compactHeight;

  const sheetTranslateY = useSharedValue(compactOffset);
  const dragStartY = useSharedValue(0);

  const panelTab = usePanelStore((s) => s.panelTab);
  const setPanelTab = usePanelStore((s) => s.setPanelTab);
  const setIsExpanded = usePanelStore((s) => s.setIsExpanded);

  const panGesture = Gesture.Pan()
    .activeOffsetY([-10, 10])
    .onStart(() => {
      dragStartY.value = sheetTranslateY.value;
    })
    .onUpdate((event) => {
      const newY = dragStartY.value + event.translationY;
      sheetTranslateY.value = Math.max(0, Math.min(compactOffset, newY));
    })
    .onEnd((event) => {
      const velocityY = event.velocityY;

      let snapToExpanded: boolean;
      if (Math.abs(velocityY) > VELOCITY_THRESHOLD) {
        // Fast flick: negative velocity = upward = expand
        snapToExpanded = velocityY < 0;
      } else {
        // Slow drag: snap to nearest
        const mid = compactOffset / 2;
        snapToExpanded = sheetTranslateY.value < mid;
      }

      const target = snapToExpanded ? 0 : compactOffset;

      runOnJS(setIsExpanded)(snapToExpanded);

      sheetTranslateY.value = withSpring(target, SPRING_CONFIG);
    });

  // Single combined animated style — merges sheet position + keyboard offset
  const keyboard = useAnimatedKeyboard();
  const animatedSheetStyle = useAnimatedStyle(() => {
    const rawKeyboardOffset = Math.max(0, keyboard.height.value - safeBottom);
    // Don't let the keyboard push the sheet above the top bar
    // sheetTranslateY: 0 = expanded, compactOffset = compact
    const maxOffset = screenHeight - expandedHeight - safeTop + sheetTranslateY.value;
    const keyboardOffset = Math.min(rawKeyboardOffset, Math.max(0, maxOffset));
    return {
      transform: [{ translateY: sheetTranslateY.value - keyboardOffset }],
    };
  });

  const isExpanded = usePanelStore((s) => s.isExpanded);
  const compactContentHeight = compactHeight - HEADER_HEIGHT;
  const expandedContentHeight = expandedHeight - HEADER_HEIGHT;
  const effectiveContentHeight = isExpanded ? expandedContentHeight : compactContentHeight;

  return (
    <Animated.View
      pointerEvents="box-none"
      className="absolute bottom-0 left-0 right-0"
      style={[{ height: expandedHeight + RIDING_HORIZON_SELECTOR_OFFSET }, animatedSheetStyle]}
    >
      <RidingHorizonSelector />

      <View
        className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg border-t border-border"
        style={{ height: expandedHeight, backgroundColor: colors.surface }}
      >
        {/* Handle + tabs — single compact gesture target */}
        <GestureDetector gesture={panGesture}>
          <Animated.View>
            <View
              className="px-2"
              style={{
                height: HEADER_HEIGHT,
                borderBottomWidth: 1,
                borderBottomColor: colors.borderSubtle,
              }}
            >
              {/* Drag handle pill */}
              <View className="items-center pt-1.5 pb-0.5">
                <View
                  className="rounded-full"
                  style={{
                    width: 32,
                    height: 4,
                    backgroundColor: colors.textTertiary,
                    opacity: 0.5,
                  }}
                />
              </View>

              {/* Tab buttons */}
              <View className="flex-row flex-1 items-center">
                {ALL_TABS.map((tab) => {
                  const isActive = panelTab === tab.key;
                  return (
                    <TouchableOpacity
                      key={tab.key}
                      className="flex-1 items-center justify-center h-full"
                      onPress={() => setPanelTab(tab.key)}
                      accessibilityLabel={`${tab.label} tab`}
                      accessibilityRole="tab"
                      accessibilityState={{ selected: isActive }}
                    >
                      <Text
                        className="text-[15px] font-barlow-semibold"
                        style={{ color: isActive ? colors.accent : colors.textTertiary }}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                        minimumFontScale={0.82}
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
            </View>
          </Animated.View>
        </GestureDetector>

        {/* Content — clips to available height */}
        <View style={{ height: effectiveContentHeight, overflow: "hidden" }}>
          {panelTab === "profile" && (
            <ProfileTabContent
              activeData={activeData}
              width={screenWidth}
              height={effectiveContentHeight}
            />
          )}
          {panelTab === "upcoming" && <UpcomingTabContent activeData={activeData} />}
          {panelTab === "weather" && <WeatherPanel activeData={activeData} />}
          {panelTab === "climbs" && <ClimbTabContent activeData={activeData} />}
          {panelTab === "pois" && <POITabContent activeData={activeData} />}
        </View>
      </View>
    </Animated.View>
  );
}
