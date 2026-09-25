import React from "react";
import { Alert, Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useBRouterProfileStore } from "@/store/brouterProfileStore";
import { cn } from "@/lib/cn";

export default function BRouterProfilePicker({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const { profiles, selectedProfileId, selectProfile } = useBRouterProfileStore();
  const insets = useSafeAreaInsets();
  const options = [{ id: null, name: "Road cycling (built-in)" }, ...profiles];
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/40">
        <Pressable
          className="absolute inset-0"
          onPress={onClose}
          accessibilityLabel="Dismiss profile picker"
        />
        <View
          className="rounded-t-2xl bg-surface px-4 pt-4"
          style={{ maxHeight: "75%", paddingBottom: Math.max(insets.bottom, 12) }}
        >
          <Text className="text-[22px] font-barlow-semibold text-foreground mb-3">
            Routing profile
          </Text>
          <ScrollView>
            {options.map((option) => (
              <Pressable
                key={option.id ?? "builtin"}
                className={cn(
                  "min-h-[52px] p-3 mb-2 rounded-xl",
                  selectedProfileId === option.id ? "bg-primary/10" : "bg-card",
                )}
                accessibilityRole="radio"
                accessibilityState={{ checked: selectedProfileId === option.id }}
                accessibilityLabel={option.name}
                onPress={() => {
                  try {
                    selectProfile(option.id);
                    onClose();
                  } catch {
                    Alert.alert("Could not select profile", "Please try again.");
                  }
                }}
              >
                <Text
                  className={cn(
                    "text-[17px]",
                    selectedProfileId === option.id
                      ? "text-primary font-barlow-semibold"
                      : "text-foreground",
                  )}
                >
                  {option.name}
                  {selectedProfileId === option.id ? " ✓" : ""}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text className="text-[15px] text-muted-foreground my-3">
            Add or edit custom profiles in Settings → BRouter profiles.
          </Text>
          <Button variant="secondary" label="Close" accessibilityRole="button" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
