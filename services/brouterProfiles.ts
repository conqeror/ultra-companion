import type { BRouterProfile } from "@/types";

export const MAX_BROUTER_PROFILE_LENGTH = 100_000;

export function validateBRouterProfile(name: string, content: string): void {
  if (!name.trim()) throw new Error("Give the profile a name.");
  if (name.trim().length > 80) throw new Error("Use a profile name of 80 characters or fewer.");
  if (!content.trim()) throw new Error("Import a .brf file or paste the profile contents.");
  if (content.length > MAX_BROUTER_PROFILE_LENGTH) {
    throw new Error("BRouter profiles must contain 100,000 characters or fewer.");
  }
}

export function decodeBRouterProfiles(raw: string | undefined): {
  profiles: BRouterProfile[];
  selectedProfileId: string | null;
} {
  const empty = { profiles: [], selectedProfileId: null };
  try {
    const value = JSON.parse(raw ?? "null");
    if (value?.version !== 1 || !Array.isArray(value.profiles)) return empty;
    const seen = new Set<string>();
    const profiles: BRouterProfile[] = value.profiles.filter(
      (profile: unknown): profile is BRouterProfile => {
        if (profile == null || typeof profile !== "object") return false;
        const p = profile as Record<string, unknown>;
        if (
          typeof p.id !== "string" ||
          !p.id ||
          seen.has(p.id) ||
          typeof p.name !== "string" ||
          typeof p.content !== "string"
        )
          return false;
        try {
          validateBRouterProfile(p.name, p.content);
        } catch {
          return false;
        }
        seen.add(p.id);
        return true;
      },
    );
    return {
      profiles,
      selectedProfileId: profiles.some((p) => p.id === value.selectedProfileId)
        ? value.selectedProfileId
        : null,
    };
  } catch {
    return empty;
  }
}
