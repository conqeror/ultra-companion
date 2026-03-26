import { View, Text, StyleSheet } from "react-native";

export default function RoutesScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>No routes imported yet.</Text>
      <Text style={styles.subtext}>Route import coming in Phase 2.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  text: {
    fontSize: 18,
    fontWeight: "600",
    color: "#333",
  },
  subtext: {
    fontSize: 14,
    color: "#888",
    marginTop: 8,
  },
});
