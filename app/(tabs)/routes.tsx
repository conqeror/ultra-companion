import React, { useEffect, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from "react-native";
import { useRouter } from "expo-router";
import { useRouteStore } from "@/store/routeStore";
import { useSettingsStore } from "@/store/settingsStore";
import { formatDistance, formatElevation } from "@/utils/formatters";
import { MIN_TOUCH_TARGET } from "@/constants";
import type { Route } from "@/types";

export default function RoutesScreen() {
  const router = useRouter();
  const {
    routes,
    isLoading,
    error,
    loadRoutes,
    importRoute,
    deleteRoute,
    toggleVisibility,
    setActiveRoute,
    clearError,
  } = useRouteStore();

  const units = useSettingsStore((s) => s.units);

  useEffect(() => {
    loadRoutes();
  }, [loadRoutes]);

  useEffect(() => {
    if (error) {
      Alert.alert("Error", error, [{ text: "OK", onPress: clearError }]);
    }
  }, [error, clearError]);

  const handleDelete = useCallback(
    (route: Route) => {
      Alert.alert(
        "Delete Route",
        `Delete "${route.name}"? This cannot be undone.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: () => deleteRoute(route.id),
          },
        ],
      );
    },
    [deleteRoute],
  );

  const renderRoute = useCallback(
    ({ item: route }: { item: Route }) => (
      <TouchableOpacity
        style={styles.routeCard}
        activeOpacity={0.7}
        onPress={() => router.push(`/route/${route.id}`)}
      >
        <View style={styles.routeHeader}>
          <View style={[styles.colorDot, { backgroundColor: route.color }]} />
          <Text style={styles.routeName} numberOfLines={1}>
            {route.name}
          </Text>
          {route.isActive && (
            <View style={styles.activeBadge}>
              <Text style={styles.activeBadgeText}>Active</Text>
            </View>
          )}
        </View>

        <View style={styles.routeStats}>
          <Text style={styles.stat}>
            {formatDistance(route.totalDistanceMeters, units)}
          </Text>
          <Text style={styles.statDivider}>·</Text>
          <Text style={styles.stat}>
            ↑ {formatElevation(route.totalAscentMeters, units)}
          </Text>
          <Text style={styles.statDivider}>·</Text>
          <Text style={styles.stat}>
            ↓ {formatElevation(route.totalDescentMeters, units)}
          </Text>
        </View>

        <View style={styles.routeActions}>
          <TouchableOpacity
            style={[styles.actionBtn, route.isActive && styles.actionBtnDisabled]}
            onPress={() => !route.isActive && setActiveRoute(route.id)}
            hitSlop={8}
          >
            <Text
              style={[
                styles.actionText,
                route.isActive && styles.actionTextDisabled,
              ]}
            >
              {route.isActive ? "Active" : "Set Active"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => toggleVisibility(route.id)}
            hitSlop={8}
          >
            <Text style={styles.actionText}>
              {route.isVisible ? "Hide" : "Show"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleDelete(route)}
            hitSlop={8}
          >
            <Text style={[styles.actionText, styles.deleteText]}>Delete</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    ),
    [units, router, setActiveRoute, toggleVisibility, handleDelete],
  );

  return (
    <View style={styles.container}>
      {routes.length === 0 && !isLoading ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No routes imported</Text>
          <Text style={styles.emptySubtitle}>
            Import a GPX or KML file to get started
          </Text>
        </View>
      ) : (
        <FlatList
          data={routes}
          keyExtractor={(r) => r.id}
          renderItem={renderRoute}
          contentContainerStyle={styles.list}
        />
      )}

      <TouchableOpacity
        style={styles.importButton}
        onPress={importRoute}
        disabled={isLoading}
        activeOpacity={0.8}
      >
        {isLoading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.importButtonText}>Import Route</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F2F2F7",
  },
  list: {
    padding: 16,
    paddingBottom: 100,
  },
  routeCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  routeHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  routeName: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    color: "#1C1C1E",
  },
  activeBadge: {
    backgroundColor: "#34C759",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    marginLeft: 8,
  },
  activeBadgeText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "600",
  },
  routeStats: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  stat: {
    fontSize: 14,
    color: "#636366",
  },
  statDivider: {
    fontSize: 14,
    color: "#C7C7CC",
    marginHorizontal: 8,
  },
  routeActions: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#E5E5EA",
    paddingTop: 12,
    gap: 16,
  },
  actionBtn: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: "center",
  },
  actionBtnDisabled: {
    opacity: 0.5,
  },
  actionText: {
    fontSize: 15,
    color: "#007AFF",
    fontWeight: "500",
  },
  actionTextDisabled: {
    color: "#8E8E93",
  },
  deleteText: {
    color: "#FF3B30",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 100,
  },
  emptyTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1C1C1E",
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 15,
    color: "#8E8E93",
  },
  importButton: {
    position: "absolute",
    bottom: 32,
    left: 20,
    right: 20,
    height: 52,
    backgroundColor: "#007AFF",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#007AFF",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  importButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
  },
});
