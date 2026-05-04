import React, { useState } from "react";
import { LayoutAnimation, TouchableOpacity, View } from "react-native";
import { Text } from "@/components/ui/text";
import { usePanelStore } from "@/store/panelStore";
import { useThemeColors } from "@/theme";
import { PANEL_MODES } from "@/constants";
import { ridingHorizonKmLabelForMode, ridingHorizonLabelForMode } from "@/utils/ridingHorizon";

const SELECTOR_HEIGHT = 48;
const SHEET_GAP = 8;
const FLOATING_SURFACE_STYLE = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 6 },
  shadowOpacity: 0.18,
  shadowRadius: 12,
  elevation: 6,
};
const ANIMATION = {
  duration: 180,
  update: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  create: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
  delete: {
    type: LayoutAnimation.Types.easeInEaseOut,
    property: LayoutAnimation.Properties.opacity,
  },
};

function animateNextLayout() {
  LayoutAnimation.configureNext(ANIMATION);
}

export default function RidingHorizonSelector() {
  const colors = useThemeColors();
  const panelMode = usePanelStore((s) => s.panelMode);
  const setPanelMode = usePanelStore((s) => s.setPanelMode);
  const [isOpen, setIsOpen] = useState(false);

  const selectedLabel = ridingHorizonLabelForMode(panelMode);

  const open = () => {
    animateNextLayout();
    setIsOpen(true);
  };

  const close = () => {
    animateNextLayout();
    setIsOpen(false);
  };

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
            ...FLOATING_SURFACE_STYLE,
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
            minWidth: 88,
            backgroundColor: colors.surfaceRaised,
            ...FLOATING_SURFACE_STYLE,
          }}
          onPress={open}
          accessibilityLabel={`Riding horizon ${selectedLabel}`}
          accessibilityRole="button"
          accessibilityState={{ expanded: false }}
        >
          <Text className="font-barlow-sc-semibold text-[15px]" style={{ color: colors.accent }}>
            {selectedLabel}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
