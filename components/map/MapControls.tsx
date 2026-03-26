import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { MIN_TOUCH_TARGET } from "@/constants";
import { usePanelStore } from "@/store/panelStore";
import type { PanelMode } from "@/types";

const PANEL_LABEL: Record<PanelMode, string> = {
  none: "\u25BD",          // ▽ down triangle — panel off
  "upcoming-5": "5",
  "upcoming-10": "10",
  "upcoming-20": "20",
  remaining: "\u25B6",     // ▶ play — to end
  full: "\u2194",          // ↔ full extent
};

interface MapControlsProps {
  onCenterUser: () => void;
  followUser: boolean;
}

export default function MapControls({
  onCenterUser,
  followUser,
}: MapControlsProps) {
  const panelMode = usePanelStore((s) => s.panelMode);
  const cyclePanelMode = usePanelStore((s) => s.cyclePanelMode);
  const panelOpen = panelMode !== "none";

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={[styles.button, followUser && styles.buttonActive]}
        onPress={onCenterUser}
        accessibilityLabel="Center on my location"
      >
        <Text style={[styles.buttonText, followUser && styles.buttonTextActive]}>
          {followUser ? "\u25C9" : "\u25CE"}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.button, panelOpen && styles.buttonActive]}
        onPress={cyclePanelMode}
        accessibilityLabel="Cycle bottom panel mode"
      >
        <Text style={[styles.buttonText, panelOpen && styles.buttonTextActive, panelOpen && styles.buttonTextSmall]}>
          {PANEL_LABEL[panelMode]}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 16,
    top: 120,
    gap: 8,
  },
  button: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: 8,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 4,
  },
  buttonActive: {
    backgroundColor: "#007AFF",
  },
  buttonText: {
    fontSize: 22,
    fontWeight: "700",
    color: "#333",
  },
  buttonTextActive: {
    color: "#fff",
  },
  buttonTextSmall: {
    fontSize: 16,
  },
});
