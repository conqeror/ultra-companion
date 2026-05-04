import React, { useState } from "react";
import { View, TouchableOpacity } from "react-native";
import { Text } from "@/components/ui/text";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import { PANEL_MODES } from "@/constants";
import { ChevronDown } from "lucide-react-native";
import { ridingHorizonKmLabelForMode } from "@/utils/ridingHorizon";

const SELECTOR_HEIGHT = 48;
const SHEET_GAP = 8;

export default function RidingHorizonSelector() {
  const colors = useThemeColors();
  const panelMode = usePanelStore((s) => s.panelMode);
  const setPanelMode = usePanelStore((s) => s.setPanelMode);
  const [isOpen, setIsOpen] = useState(false);

  const selectedKm = ridingHorizonKmLabelForMode(panelMode);

  return (
    <View
      className="absolute right-3"
      style={{
        top: -SELECTOR_HEIGHT - SHEET_GAP,
        left: isOpen ? 12 : undefined,
        zIndex: 20,
      }}
    >
      {isOpen ? (
        <View
          className="flex-row items-center rounded-full border border-border"
          style={{
            backgroundColor: colors.surfaceRaised,
            padding: 2,
            gap: 4,
            height: SELECTOR_HEIGHT,
          }}
        >
          {PANEL_MODES.map((mode) => {
            const isActive = mode === panelMode;
            const km = ridingHorizonKmLabelForMode(mode);
            return (
              <TouchableOpacity
                key={mode}
                onPress={() => {
                  setPanelMode(mode);
                  setIsOpen(false);
                }}
                hitSlop={{ left: 2, right: 2 }}
                accessibilityLabel={`Set riding horizon to ${km} km`}
                accessibilityRole="button"
                accessibilityState={{ selected: isActive }}
                className="flex-1 rounded-full items-center justify-center"
                style={{
                  minWidth: 44,
                  height: 44,
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
      ) : (
        <TouchableOpacity
          className="self-end flex-row items-center justify-center rounded-full border border-border px-4"
          style={{
            height: SELECTOR_HEIGHT,
            minWidth: 92,
            backgroundColor: colors.surfaceRaised,
          }}
          onPress={() => setIsOpen(true)}
          accessibilityLabel={`Riding horizon ${selectedKm} km`}
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
        >
          <Text className="font-barlow-sc-semibold text-[15px]" style={{ color: colors.accent }}>
            {selectedKm} km
          </Text>
          <ChevronDown size={16} color={colors.accent} style={{ marginLeft: 6 }} />
        </TouchableOpacity>
      )}
    </View>
  );
}
