import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { WifiOff } from "lucide-react-native";
import { useOfflineStore } from "@/store/offlineStore";
import { useThemeColors } from "@/theme";

export default function ConnectivityIndicator() {
  const isConnected = useOfflineStore((s) => s.isConnected);
  const colors = useThemeColors();

  if (isConnected) return null;

  return (
    <View className="flex-row items-center bg-card/95 border border-border-subtle rounded-full px-3 py-1.5 mt-3 shadow-sm">
      <WifiOff size={14} color={colors.warning} />
      <Text className="text-[12px] font-barlow-medium text-warning ml-1.5">
        Offline
      </Text>
    </View>
  );
}
