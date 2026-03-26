import React from "react";
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { MIN_TOUCH_TARGET } from "@/constants";

interface MapControlsProps {
  onCenterUser: () => void;
  followUser: boolean;
}

export default function MapControls({
  onCenterUser,
  followUser,
}: MapControlsProps) {
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    right: 16,
    top: 120,
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
});
