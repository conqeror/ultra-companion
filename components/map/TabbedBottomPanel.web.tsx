import React, { useEffect, useState } from "react";
import { ActivityIndicator, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Activity, Clock3, MapPin, Mountain } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { cn } from "@/lib/cn";
import { useThemeColors } from "@/theme";
import { useClimbStore } from "@/store/climbStore";
import { usePanelStore } from "@/store/panelStore";
import ProfileTabContent from "./ProfileTabContent";
import UpcomingTabContent from "./UpcomingTabContent";
import ClimbTabContent from "./ClimbTabContent";
import POITabContent from "./POITabContent";
import {
  WEB_PANEL_MARGIN,
  getWebBottomPanelHeight,
  getWebBottomPanelRightInset,
  getWebSidebarWidth,
} from "./webPanelLayout";
import type { ActiveRouteData, PanelTab } from "@/types";

const BOTTOM_RAIL_WIDTH = 58;
const SIDEBAR_HEADER_HEIGHT = 52;
const WEB_PANEL_ICON_STROKE_WIDTH = 1.85;

const BOTTOM_TABS = [
  { key: "profile", label: "Profile", icon: Activity },
  { key: "climbs", label: "Climbs", icon: Mountain },
] as const satisfies readonly {
  key: PanelTab;
  label: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
}[];

const SIDEBAR_TABS = [
  { key: "upcoming", label: "Upcoming", icon: Clock3 },
  { key: "pois", label: "POIs", icon: MapPin },
] as const;

type SidebarTab = (typeof SIDEBAR_TABS)[number]["key"];

interface TabbedBottomPanelProps {
  activeData: ActiveRouteData | null;
  isLoadingActiveData?: boolean;
}

function TabbedBottomPanel({ activeData, isLoadingActiveData = false }: TabbedBottomPanelProps) {
  const colors = useThemeColors();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const { bottom: safeBottom } = useSafeAreaInsets();
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("upcoming");
  const panelTab = usePanelStore((s) => s.panelTab);
  const setPanelTab = usePanelStore((s) => s.setPanelTab);
  const setPanelMode = usePanelStore((s) => s.setPanelMode);
  const setIsExpanded = usePanelStore((s) => s.setIsExpanded);
  const setSelectedClimb = useClimbStore((s) => s.setSelectedClimb);

  const sidebarWidth = getWebSidebarWidth(screenWidth);
  const bottomPanelHeight = getWebBottomPanelHeight(screenHeight, safeBottom);
  const bottomPanelRightInset = getWebBottomPanelRightInset(screenWidth);
  const bottomPanelWidth = Math.max(
    320,
    screenWidth - WEB_PANEL_MARGIN - bottomPanelRightInset - BOTTOM_RAIL_WIDTH,
  );
  const bottomTab = panelTab === "climbs" ? "climbs" : "profile";

  useEffect(() => {
    setPanelMode("full-route");
    setIsExpanded(true);
  }, [setIsExpanded, setPanelMode]);

  useEffect(() => {
    if (panelTab === "weather" || panelTab === "upcoming" || panelTab === "pois") {
      setPanelTab("profile");
    }
  }, [panelTab, setPanelTab]);

  const handleBottomTabPress = (tab: (typeof BOTTOM_TABS)[number]["key"]) => {
    if (tab === "climbs" && panelTab !== "climbs") setSelectedClimb(null);
    setPanelTab(tab);
  };

  return (
    <View pointerEvents="box-none" className="absolute inset-0">
      {sidebarWidth > 0 && (
        <View
          pointerEvents="auto"
          className="absolute rounded-lg shadow-lg border border-border overflow-hidden"
          style={{
            top: WEB_PANEL_MARGIN,
            right: WEB_PANEL_MARGIN,
            bottom: WEB_PANEL_MARGIN,
            width: sidebarWidth,
            backgroundColor: colors.surface,
          }}
        >
          <View
            className="flex-row items-center px-1.5"
            style={{
              height: SIDEBAR_HEADER_HEIGHT,
              borderBottomWidth: 1,
              borderBottomColor: colors.borderSubtle,
            }}
          >
            {SIDEBAR_TABS.map((tab) => (
              <SidebarTabButton
                key={tab.key}
                label={tab.label}
                icon={tab.icon}
                selected={sidebarTab === tab.key}
                onPress={() => setSidebarTab(tab.key)}
              />
            ))}
          </View>
          <View style={{ flex: 1, overflow: "hidden" }}>
            {isLoadingActiveData ? (
              <ActiveRouteLoadingState />
            ) : sidebarTab === "upcoming" ? (
              <UpcomingTabContent activeData={activeData} />
            ) : (
              <POITabContent activeData={activeData} />
            )}
          </View>
        </View>
      )}

      <View
        className="absolute rounded-lg shadow-lg border border-border overflow-hidden"
        style={{
          left: WEB_PANEL_MARGIN,
          right: bottomPanelRightInset,
          bottom: WEB_PANEL_MARGIN,
          height: bottomPanelHeight,
          backgroundColor: colors.surface,
        }}
      >
        <View className="flex-1 flex-row">
          <View
            className="items-center py-2"
            style={{
              width: BOTTOM_RAIL_WIDTH,
              borderRightWidth: 1,
              borderRightColor: colors.borderSubtle,
              gap: 8,
            }}
          >
            {BOTTOM_TABS.map((tab) => (
              <BottomRailButton
                key={tab.key}
                label={tab.label}
                icon={tab.icon}
                selected={bottomTab === tab.key}
                onPress={() => handleBottomTabPress(tab.key)}
              />
            ))}
          </View>

          <View style={{ flex: 1, overflow: "hidden" }}>
            {isLoadingActiveData ? (
              <ActiveRouteLoadingState />
            ) : bottomTab === "profile" ? (
              <ProfileTabContent
                activeData={activeData}
                width={bottomPanelWidth}
                height={bottomPanelHeight}
                showClimbsAheadStrip={false}
              />
            ) : (
              <ClimbTabContent
                activeData={activeData}
                width={bottomPanelWidth}
                presentation="web"
              />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}

function ActiveRouteLoadingState() {
  const colors = useThemeColors();
  return (
    <View
      className="flex-1 items-center justify-center px-6"
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading active route"
    >
      <ActivityIndicator size="large" color={colors.accent} />
      <Text className="mt-3 text-[15px] font-barlow-medium text-foreground">
        Loading active route…
      </Text>
    </View>
  );
}

function BottomRailButton({
  label,
  icon: Icon,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      className={cn("h-[48px] w-[48px] items-center justify-center rounded-lg")}
      style={{ backgroundColor: selected ? colors.accentSubtle : "transparent" }}
      onPress={onPress}
      accessibilityLabel={`${label} tab`}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      activeOpacity={0.78}
    >
      <Icon
        size={22}
        color={selected ? colors.accent : colors.textTertiary}
        strokeWidth={WEB_PANEL_ICON_STROKE_WIDTH}
      />
    </TouchableOpacity>
  );
}

function SidebarTabButton({
  label,
  icon: Icon,
  selected,
  onPress,
}: {
  label: string;
  icon: React.ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
  selected: boolean;
  onPress: () => void;
}) {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      className="h-full flex-1 flex-row items-center justify-center gap-2"
      onPress={onPress}
      accessibilityLabel={`${label} panel`}
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      activeOpacity={0.78}
    >
      <Icon
        size={17}
        color={selected ? colors.accent : colors.textTertiary}
        strokeWidth={WEB_PANEL_ICON_STROKE_WIDTH}
      />
      <Text
        className="text-[14px] font-barlow-semibold"
        style={{ color: selected ? colors.accent : colors.textTertiary }}
        numberOfLines={1}
      >
        {label}
      </Text>
      {selected && (
        <View
          className="absolute bottom-0 left-3 right-3 rounded-t-sm"
          style={{ height: 2, backgroundColor: colors.accent }}
        />
      )}
    </TouchableOpacity>
  );
}

export default React.memo(
  TabbedBottomPanel,
  (prev, next) =>
    prev.activeData === next.activeData && prev.isLoadingActiveData === next.isLoadingActiveData,
);
