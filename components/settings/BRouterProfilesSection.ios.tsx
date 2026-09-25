import React, { useState } from "react";
import { Alert, KeyboardAvoidingView, Modal, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useBRouterProfileStore } from "@/store/brouterProfileStore";
import { MAX_BROUTER_PROFILE_LENGTH } from "@/services/brouterProfiles";
import { useThemeColors } from "@/theme";
import type { BRouterProfile } from "@/types";

export default function BRouterProfilesSection() {
  const profiles = useBRouterProfileStore((s) => s.profiles);
  const deleteProfile = useBRouterProfileStore((s) => s.deleteProfile);
  const [editing, setEditing] = useState<BRouterProfile | null | undefined>(undefined);
  const remove = (profile: BRouterProfile) =>
    Alert.alert(
      "Delete profile?",
      `Delete “${profile.name}”? Saved routes will remain available.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            try {
              deleteProfile(profile.id);
            } catch {
              Alert.alert(
                "Could not delete profile",
                "Your saved profiles have not changed. Try again.",
              );
            }
          },
        },
      ],
    );
  return (
    <View className="mt-6 gap-3">
      <Text className="text-[22px] font-barlow-semibold text-foreground">BRouter profiles</Text>
      <Text className="text-[15px] text-muted-foreground">
        Save custom .brf profiles here, then choose one when planning a route.
      </Text>
      {profiles.map((profile) => (
        <View key={profile.id} className="rounded-xl bg-card p-3">
          <Text className="text-[17px] font-barlow-semibold text-foreground">{profile.name}</Text>
          <View className="flex-row gap-3 mt-2">
            <Button
              className="flex-1"
              variant="secondary"
              label="Edit"
              accessibilityRole="button"
              accessibilityLabel={`Edit profile ${profile.name}`}
              onPress={() => setEditing(profile)}
            />
            <Button
              className="flex-1"
              variant="destructive"
              label="Delete"
              accessibilityRole="button"
              accessibilityLabel={`Delete profile ${profile.name}`}
              onPress={() => remove(profile)}
            />
          </View>
        </View>
      ))}
      <Button
        variant="secondary"
        label="Add BRouter profile"
        accessibilityRole="button"
        onPress={() => setEditing(null)}
      />
      {editing !== undefined && (
        <ProfileEditor profile={editing} onClose={() => setEditing(undefined)} />
      )}
    </View>
  );
}

function ProfileEditor({
  profile,
  onClose,
}: {
  profile: BRouterProfile | null;
  onClose: () => void;
}) {
  const [name, setName] = useState(profile?.name ?? "");
  const [content, setContent] = useState(profile?.content ?? "");
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const colors = useThemeColors();
  const insets = useSafeAreaInsets();
  const close = () => {
    if (!importing) onClose();
  };

  const importFile = async () => {
    if (importing) return;
    setImporting(true);
    setError(null);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset.name.toLowerCase().endsWith(".brf"))
        throw new Error("Choose a BRouter .brf profile file.");
      const file = new File(asset.uri);
      if ((asset.size ?? file.size) > MAX_BROUTER_PROFILE_LENGTH * 4)
        throw new Error("This profile file is too large.");
      const text = await file.text();
      if (text.length > MAX_BROUTER_PROFILE_LENGTH)
        throw new Error("BRouter profiles must contain 100,000 characters or fewer.");
      setContent(text);
      if (!name.trim()) setName(asset.name.replace(/\.brf$/i, ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the profile file.");
    } finally {
      setImporting(false);
    }
  };

  const save = () => {
    if (importing) return;
    try {
      useBRouterProfileStore.getState().saveProfile(name, content, profile?.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the profile. Try again.");
    }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="fullScreen" onRequestClose={close}>
      <View
        className="flex-1 bg-background"
        style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
      >
        <KeyboardAvoidingView className="flex-1" behavior="padding">
          <ScrollView
            className="flex-1 px-4"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <Text className="text-[22px] font-barlow-semibold text-foreground mt-4 mb-3">
              {profile ? "Edit BRouter profile" : "Add BRouter profile"}
            </Text>
            <Text className="text-[15px] text-muted-foreground mb-3">
              Import a .brf file or paste its contents. Profiles are saved on this phone and sent to
              BRouter when used. Syntax is checked when calculating a route.
            </Text>
            <Text className="text-[15px] font-barlow-medium text-foreground">Name</Text>
            <TextInput
              className="min-h-[52px] rounded-xl border border-border bg-card px-3 mt-2 mb-3 text-[17px] font-barlow text-foreground"
              style={{ color: colors.textPrimary }}
              placeholderTextColor={colors.textTertiary}
              placeholder="e.g. Quiet roads"
              accessibilityLabel="BRouter profile name"
              value={name}
              onChangeText={setName}
              autoCorrect={false}
              maxLength={80}
            />
            <Button
              variant="secondary"
              label={importing ? "Importing…" : "Import .brf file"}
              accessibilityRole="button"
              disabled={importing}
              onPress={() => void importFile()}
            />
            <Text className="text-[15px] font-barlow-medium text-foreground mt-4 mb-2">
              Profile contents
            </Text>
            <TextInput
              className="rounded-xl border border-border bg-card p-3 text-foreground"
              style={{
                minHeight: 240,
                fontFamily: "Menlo",
                fontSize: 13,
                color: colors.textPrimary,
              }}
              placeholder="Paste BRouter profile text"
              placeholderTextColor={colors.textTertiary}
              accessibilityLabel="BRouter profile contents"
              multiline
              textAlignVertical="top"
              keyboardType="ascii-capable"
              smartInsertDelete={false}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              value={content}
              onChangeText={setContent}
            />
            {error && (
              <Text accessibilityRole="alert" className="text-[15px] text-destructive mt-3">
                {error}
              </Text>
            )}
          </ScrollView>
          <View className="flex-row gap-3 px-4 py-3 border-t border-border">
            <Button
              className="flex-1"
              variant="secondary"
              label="Cancel"
              accessibilityRole="button"
              disabled={importing}
              onPress={close}
            />
            <Button
              className="flex-1"
              label="Save profile"
              accessibilityRole="button"
              disabled={importing}
              onPress={save}
            />
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}
