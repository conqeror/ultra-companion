import React from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useBRouterProfileStore } from "@/store/brouterProfileStore";
import { MAX_COMPARED_BROUTER_PROFILES } from "@/store/routePlannerStore";
import { useThemeColors } from "@/theme";
import { cn } from "@/lib/cn";

export default function BRouterProfilePicker({
  visible,
  selectedProfileIds,
  onChange,
  onClose,
}: {
  visible: boolean;
  selectedProfileIds: readonly (string | null)[];
  onChange: (profileIds: readonly (string | null)[]) => void;
  onClose: () => void;
}) {
  const profiles = useBRouterProfileStore((state) => state.profiles);
  const insets = useSafeAreaInsets();
  const colors = useThemeColors();
  const options = [{ id: null, name: "Road cycling (built-in)" }, ...profiles];

  const toggle = (profileId: string | null) => {
    const selected = selectedProfileIds.includes(profileId);
    if (selected) {
      if (selectedProfileIds.length === 1) return;
      onChange(selectedProfileIds.filter((id) => id !== profileId));
      return;
    }
    if (selectedProfileIds.length >= MAX_COMPARED_BROUTER_PROFILES) return;
    onChange([...selectedProfileIds, profileId]);
  };

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
          <Text className="text-[22px] font-barlow-semibold text-foreground">
            Compare routing profiles
          </Text>
          <Text className="mb-3 mt-1 text-[15px] text-muted-foreground">
            Choose up to {MAX_COMPARED_BROUTER_PROFILES}. All use the same route points.
          </Text>
          <ScrollView>
            {options.map((option) => {
              const selected = selectedProfileIds.includes(option.id);
              const disabled =
                !selected && selectedProfileIds.length >= MAX_COMPARED_BROUTER_PROFILES;
              return (
                <Pressable
                  key={option.id ?? "builtin"}
                  className={cn(
                    "min-h-[52px] px-3 py-2 mb-2 rounded-xl flex-row items-center gap-3",
                    selected ? "bg-primary/10" : "bg-card",
                    disabled && "opacity-50",
                  )}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: selected, disabled }}
                  accessibilityLabel={option.name}
                  disabled={disabled}
                  onPress={() => toggle(option.id)}
                >
                  <View
                    className={cn(
                      "h-7 w-7 rounded-lg border items-center justify-center",
                      selected ? "border-primary bg-primary" : "border-border bg-surface",
                    )}
                  >
                    {selected && <Check size={18} color={colors.accentForeground} />}
                  </View>
                  <Text
                    className={cn(
                      "flex-1 text-[17px]",
                      selected ? "text-primary font-barlow-semibold" : "text-foreground",
                    )}
                  >
                    {option.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
          <Text className="text-[13px] text-muted-foreground my-3">
            Add or edit custom profiles in Settings → BRouter profiles.
          </Text>
          <Button label="Done" accessibilityRole="button" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}
