import React from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import { PANEL_MODES } from "@/constants";
import { ridingHorizonKmLabelForMode } from "@/utils/ridingHorizon";

export const RIDING_HORIZON_SELECTOR_HEIGHT = 56;

export default function RidingHorizonSelector() {
  const colors = useThemeColors();
  const panelMode = usePanelStore((s) => s.panelMode);
  const setPanelMode = usePanelStore((s) => s.setPanelMode);

  return (
    <View
      className="flex-row items-center px-3"
      style={{
        height: RIDING_HORIZON_SELECTOR_HEIGHT,
        borderBottomWidth: 1,
        borderBottomColor: colors.borderSubtle,
      }}
    >
      <Text className="text-[12px] font-barlow-semibold text-muted-foreground mr-2">Horizon</Text>
      <View
        className="flex-1 flex-row items-center rounded-full"
        style={{ backgroundColor: colors.surfaceRaised, padding: 2, gap: 4 }}
      >
        {PANEL_MODES.map((mode) => {
          const isActive = mode === panelMode;
          const km = ridingHorizonKmLabelForMode(mode);
          return (
            <TouchableOpacity
              key={mode}
              onPress={() => setPanelMode(mode)}
              hitSlop={{ left: 2, right: 2 }}
              accessibilityLabel={`Set riding horizon to ${km} km`}
              accessibilityRole="button"
              accessibilityState={{ selected: isActive }}
              className="flex-1 rounded-full items-center justify-center"
              style={{
                minWidth: 44,
                height: 48,
                backgroundColor: isActive ? colors.accent : "transparent",
              }}
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
      </View>
    </View>
  );
}
