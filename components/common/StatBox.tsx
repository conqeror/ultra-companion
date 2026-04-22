import React from "react";
import { View } from "react-native";
import { Text } from "@/components/ui/text";

interface StatBoxProps {
  label: string;
  value: string;
}

export default function StatBox({ label, value }: StatBoxProps) {
  return (
    <View className="flex-1 items-center">
      <Text className="font-barlow-sc-semibold text-lg text-foreground" numberOfLines={1}>
        {value}
      </Text>
      <Text className="font-barlow-sc-medium text-xs text-muted-foreground">{label}</Text>
    </View>
  );
}
