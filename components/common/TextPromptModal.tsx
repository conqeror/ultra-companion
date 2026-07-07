import React, { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, TextInput, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/theme";
import { cn } from "@/lib/cn";

interface TextPromptModalProps {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  requireValue?: boolean;
  onCancel: () => void;
  onSubmit: (value: string) => Promise<void> | void;
}

export default function TextPromptModal({
  visible,
  title,
  message,
  placeholder,
  initialValue = "",
  confirmLabel = "OK",
  cancelLabel = "Cancel",
  requireValue = true,
  onCancel,
  onSubmit,
}: TextPromptModalProps) {
  const colors = useThemeColors();
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (visible) {
      setValue(initialValue);
      setIsSubmitting(false);
    }
  }, [initialValue, visible]);

  const trimmed = value.trim();
  const submitDisabled = isSubmitting || (requireValue && trimmed.length === 0);

  const handleSubmit = async () => {
    if (submitDisabled) return;
    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      onCancel();
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        className="flex-1 justify-center bg-black/40 px-5"
      >
        <Pressable className="absolute inset-0" onPress={onCancel} />
        <View className="rounded-xl border border-border bg-surface p-4">
          <Text className="text-[22px] font-barlow-semibold text-foreground">{title}</Text>
          {message && (
            <Text className="mt-1 text-[13px] font-barlow text-muted-foreground">{message}</Text>
          )}
          <TextInput
            className="mt-4 min-h-[52px] rounded-xl border border-border bg-card px-3 text-[17px] font-barlow text-foreground"
            style={{ color: colors.textPrimary }}
            placeholder={placeholder}
            placeholderTextColor={colors.textTertiary}
            value={value}
            onChangeText={setValue}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={handleSubmit}
            accessibilityLabel={title}
          />
          <View className="mt-4 flex-row gap-2">
            <Button
              className="h-12 flex-1"
              variant="secondary"
              label={cancelLabel}
              onPress={onCancel}
              disabled={isSubmitting}
            />
            <Button
              className={cn("h-12 flex-1", submitDisabled && "opacity-50")}
              label={isSubmitting ? "Saving..." : confirmLabel}
              onPress={handleSubmit}
              disabled={submitDisabled}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
