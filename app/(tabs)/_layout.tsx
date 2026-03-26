import React from "react";
import { Tabs } from "expo-router";
import { SymbolView } from "expo-symbols";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: "#007AFF",
        tabBarInactiveTintColor: "#8E8E93",
        tabBarStyle: {
          borderTopColor: "#E5E5EA",
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Map",
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "map.fill", android: "map", web: "map" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="routes"
        options={{
          title: "Routes",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "point.topleft.down.to.point.bottomright.curvepath.fill", android: "route", web: "route" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: "Settings",
          tabBarIcon: ({ color }) => (
            <SymbolView
              name={{ ios: "gearshape.fill", android: "settings", web: "settings" }}
              tintColor={color}
              size={24}
            />
          ),
        }}
      />
    </Tabs>
  );
}
