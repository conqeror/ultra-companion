import React, { useState } from "react";
import { View, TouchableOpacity, SafeAreaView } from "react-native";
import { useRouter } from "expo-router";
import { Text } from "@/components/ui/text";
import { X } from "lucide-react-native";
import { useThemeColors } from "@/theme";
import RoutesScreen from "@/app/(tabs)/routes";
import SettingsScreen from "@/app/(tabs)/settings";

type MenuTab = "routes" | "settings";

export default function MenuScreen() {
  const router = useRouter();
  const colors = useThemeColors();
  const [tab, setTab] = useState<MenuTab>("routes");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      {/* Header */}
      <View className="flex-row items-center justify-between px-4 pt-2 pb-3">
        <View className="flex-row gap-4">
          <TouchableOpacity
            className="min-h-[48px] px-3 justify-center"
            onPress={() => setTab("routes")}
          >
            <Text
              className="text-[17px] font-barlow-semibold"
              style={{ color: tab === "routes" ? colors.textPrimary : colors.textTertiary }}
            >
              Routes
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            className="min-h-[48px] px-3 justify-center"
            onPress={() => setTab("settings")}
          >
            <Text
              className="text-[17px] font-barlow-semibold"
              style={{ color: tab === "settings" ? colors.textPrimary : colors.textTertiary }}
            >
              Settings
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="w-[48px] h-[48px] items-center justify-center"
          onPress={() => router.back()}
          accessibilityLabel="Close menu"
        >
          <X size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={{ flex: 1 }}>
        {tab === "routes" ? <RoutesScreen /> : <SettingsScreen />}
      </View>
    </SafeAreaView>
  );
}
