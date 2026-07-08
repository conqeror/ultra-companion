import React from "react";
import { ActivityIndicator, View, TouchableOpacity, useWindowDimensions } from "react-native";
import { Activity, Clock3, CloudSun, MapPin, Mountain } from "lucide-react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedKeyboard,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemeColors } from "@/theme";
import { Text } from "@/components/ui/text";
import { useClimbStore } from "@/store/climbStore";
import { useEtaStore } from "@/store/etaStore";
import { usePanelStore } from "@/store/panelStore";
import { SHEET_COMPACT_RATIO, SHEET_EXPANDED_RATIO } from "@/constants";
import ProfileTabContent from "./ProfileTabContent";
import UpcomingTabContent from "./UpcomingTabContent";
import WeatherPanel from "./WeatherPanel";
import ClimbTabContent from "./ClimbTabContent";
import POITabContent from "./POITabContent";
import RidingHorizonSelector, { RIDING_HORIZON_SELECTOR_OFFSET } from "./RidingHorizonSelector";
import type { ActiveRouteData, PanelTab } from "@/types";

/** Compact drag target at the top of the content sheet */
const DRAG_HANDLE_HEIGHT = 18;
const DRAG_HANDLE_HIT_HEIGHT = 48;
const DRAG_HANDLE_HIT_WIDTH = 160;

/** Visible icon rail height before the safe-area inset */
const TAB_BAR_HEIGHT = 50;
const TAB_BAR_SAFE_AREA_OVERLAP = 24;
const ETA_STATUS_HEIGHT = 30;

const PANEL_ICON_STROKE_WIDTH = 2;

/** No bounce — clamp at snap points */
const SPRING_CONFIG = { damping: 28, stiffness: 300, overshootClamping: true };

/** Velocity threshold — fast flick snaps in the flick direction */
const VELOCITY_THRESHOLD = 500;

interface TabDef {
  key: PanelTab;
  label: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
}

const ALL_TABS: TabDef[] = [
  { key: "profile", label: "Profile", icon: Activity },
  { key: "upcoming", label: "Upcoming", icon: Clock3 },
  { key: "weather", label: "Weather", icon: CloudSun },
  { key: "climbs", label: "Climbs", icon: Mountain },
  { key: "pois", label: "POIs", icon: MapPin },
];

interface TabbedBottomPanelProps {
  activeData: ActiveRouteData | null;
}

function TabbedBottomPanel({ activeData }: TabbedBottomPanelProps) {
  const colors = useThemeColors();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { top: safeTop, bottom: safeBottom } = useSafeAreaInsets();

  const compactHeight = Math.round(screenHeight * SHEET_COMPACT_RATIO) + safeBottom;
  const expandedHeight = Math.round(screenHeight * SHEET_EXPANDED_RATIO) + safeBottom;
  const tabBarSafePadding = Math.max(0, safeBottom - TAB_BAR_SAFE_AREA_OVERLAP);
  const tabBarHeight = TAB_BAR_HEIGHT + tabBarSafePadding;
  const contentPanelHeight = Math.max(0, expandedHeight - tabBarHeight);

  // The content panel is anchored above the fixed icon rail.
  // translateY pushes it down: compactOffset shows only compactHeight, 0 shows full expandedHeight.
  const compactOffset = expandedHeight - compactHeight;

  const sheetTranslateY = useSharedValue(compactOffset);
  const dragStartY = useSharedValue(0);

  const panelTab = usePanelStore((s) => s.panelTab);
  const setPanelTab = usePanelStore((s) => s.setPanelTab);
  const setIsExpanded = usePanelStore((s) => s.setIsExpanded);
  const isExpanded = usePanelStore((s) => s.isExpanded);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);
  const etaStatus = useEtaStore((s) => s.etaStatus);
  const etaProgress = useEtaStore((s) => s.etaProgress);
  const etaRouteId = useEtaStore((s) => s.routeId);
  const cumulativeTime = useEtaStore((s) => s.cumulativeTime);

  const handleTabPress = React.useCallback(
    (tab: PanelTab) => {
      if (tab === "climbs" && panelTab !== "climbs") setSelectedClimb(null);
      setPanelTab(tab);
    },
    [panelTab, setPanelTab, setSelectedClimb],
  );

  const handleToggleExpanded = React.useCallback(() => {
    const nextIsExpanded = !isExpanded;
    setIsExpanded(nextIsExpanded);
    sheetTranslateY.value = withSpring(nextIsExpanded ? 0 : compactOffset, SPRING_CONFIG);
  }, [compactOffset, isExpanded, setIsExpanded, sheetTranslateY]);

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

  // Merges sheet position + keyboard offset so controls stay reachable during text entry.
  const keyboard = useAnimatedKeyboard();
  const animatedContentStyle = useAnimatedStyle(() => {
    const rawKeyboardOffset = Math.max(0, keyboard.height.value - safeBottom);
    // Don't let the keyboard push the sheet above the top bar
    // sheetTranslateY: 0 = expanded, compactOffset = compact
    const maxOffset = screenHeight - expandedHeight - safeTop + sheetTranslateY.value;
    const keyboardOffset = Math.min(rawKeyboardOffset, Math.max(0, maxOffset));
    return {
      transform: [{ translateY: sheetTranslateY.value - keyboardOffset }],
    };
  });
  const animatedTabBarStyle = useAnimatedStyle(() => {
    const rawKeyboardOffset = Math.max(0, keyboard.height.value - safeBottom);
    const maxOffset = screenHeight - expandedHeight - safeTop + sheetTranslateY.value;
    const keyboardOffset = Math.min(rawKeyboardOffset, Math.max(0, maxOffset));
    return {
      transform: [{ translateY: -keyboardOffset }],
    };
  });

  const compactContentHeight = Math.max(0, compactHeight - tabBarHeight - DRAG_HANDLE_HEIGHT);
  const expandedContentHeight = Math.max(0, expandedHeight - tabBarHeight - DRAG_HANDLE_HEIGHT);
  const effectiveContentHeight = isExpanded ? expandedContentHeight : compactContentHeight;
  const showETAStatus =
    !!activeData &&
    etaRouteId === activeData.id &&
    !cumulativeTime &&
    (etaStatus === "loading" || etaStatus === "computing");
  const etaBodyHeight = Math.max(
    0,
    effectiveContentHeight - (showETAStatus ? ETA_STATUS_HEIGHT : 0),
  );
  const etaLabel =
    etaStatus === "computing" && etaProgress
      ? `Calculating ETA... ${Math.round((etaProgress.computedPoints / Math.max(1, etaProgress.totalPoints)) * 100)}%`
      : "Calculating ETA...";

  return (
    <View
      pointerEvents="box-none"
      className="absolute bottom-0 left-0 right-0"
      style={{ height: expandedHeight + RIDING_HORIZON_SELECTOR_OFFSET }}
    >
      <Animated.View
        pointerEvents="box-none"
        className="absolute left-0 right-0"
        style={[
          {
            bottom: tabBarHeight,
            height: contentPanelHeight + RIDING_HORIZON_SELECTOR_OFFSET,
          },
          animatedContentStyle,
        ]}
      >
        <RidingHorizonSelector />

        <View
          className="absolute bottom-0 left-0 right-0 rounded-t-2xl shadow-lg border-t border-border"
          style={{ height: contentPanelHeight, backgroundColor: colors.surface }}
        >
          <View
            className="items-center justify-center"
            style={{
              height: DRAG_HANDLE_HEIGHT,
              borderBottomWidth: 1,
              borderBottomColor: colors.borderSubtle,
            }}
          >
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

          {/* Invisible 48dp grab/tap target over the compact visual handle. */}
          <GestureDetector gesture={panGesture}>
            <Animated.View
              className="absolute top-0 z-10 items-center justify-start"
              style={{
                alignSelf: "center",
                height: DRAG_HANDLE_HIT_HEIGHT,
                width: DRAG_HANDLE_HIT_WIDTH,
              }}
            >
              <TouchableOpacity
                className="h-full w-full items-center justify-start pt-[7px]"
                onPress={handleToggleExpanded}
                accessibilityLabel={isExpanded ? "Collapse bottom panel" : "Expand bottom panel"}
                accessibilityRole="button"
                accessibilityState={{ expanded: isExpanded }}
                activeOpacity={1}
              >
                <View
                  className="rounded-full"
                  style={{
                    width: 32,
                    height: 4,
                    backgroundColor: colors.textTertiary,
                    opacity: 0.5,
                  }}
                />
              </TouchableOpacity>
            </Animated.View>
          </GestureDetector>

          {/* Content — clips to available height */}
          <View style={{ height: effectiveContentHeight, overflow: "hidden" }}>
            {showETAStatus && (
              <View
                className="flex-row items-center justify-center gap-2 border-b border-border-subtle"
                style={{ height: ETA_STATUS_HEIGHT, backgroundColor: colors.surfaceRaised }}
              >
                <ActivityIndicator size="small" color={colors.accent} />
                <Text className="text-[13px] font-barlow-medium text-muted-foreground">
                  {etaLabel}
                </Text>
              </View>
            )}
            <View style={{ height: etaBodyHeight, overflow: "hidden" }}>
              {panelTab === "profile" && (
                <ProfileTabContent
                  activeData={activeData}
                  width={screenWidth}
                  height={etaBodyHeight}
                />
              )}
              {panelTab === "upcoming" && <UpcomingTabContent activeData={activeData} />}
              {panelTab === "weather" && <WeatherPanel activeData={activeData} />}
              {panelTab === "climbs" && <ClimbTabContent activeData={activeData} />}
              {panelTab === "pois" && <POITabContent activeData={activeData} />}
            </View>
          </View>
        </View>
      </Animated.View>

      <Animated.View
        className="absolute bottom-0 left-0 right-0 border-t border-border-subtle"
        style={[
          {
            height: tabBarHeight,
            paddingBottom: tabBarSafePadding,
            backgroundColor: colors.surface,
          },
          animatedTabBarStyle,
        ]}
      >
        <Animated.View className="h-full flex-row items-start px-2">
          {ALL_TABS.map((tab) => {
            const isActive = panelTab === tab.key;
            const Icon = tab.icon;
            return (
              <TouchableOpacity
                key={tab.key}
                className="h-[50px] flex-1 items-center justify-center"
                onPress={() => handleTabPress(tab.key)}
                accessibilityLabel={`${tab.label} tab`}
                accessibilityRole="tab"
                accessibilityState={{ selected: isActive }}
                activeOpacity={0.78}
              >
                <View
                  className="h-[44px] w-[44px] items-center justify-center rounded-lg"
                  style={{ backgroundColor: isActive ? colors.accentSubtle : "transparent" }}
                >
                  <Icon
                    size={24}
                    color={isActive ? colors.accent : colors.textTertiary}
                    strokeWidth={PANEL_ICON_STROKE_WIDTH}
                  />
                </View>
              </TouchableOpacity>
            );
          })}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

export default React.memo(TabbedBottomPanel, (prev, next) => prev.activeData === next.activeData);
