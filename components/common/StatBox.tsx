import React from "react";
import { View, Text, StyleSheet } from "react-native";

interface StatBoxProps {
  label: string;
  value: string;
}

export default function StatBox({ label, value }: StatBoxProps) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statBox: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    alignItems: "center",
  },
  statValue: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 2,
  },
  statLabel: {
    fontSize: 12,
    color: "#8E8E93",
  },
});
