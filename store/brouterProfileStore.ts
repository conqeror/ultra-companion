import { create } from "zustand";
import { createKeyValueStorage, type KeyValueStorage } from "@/lib/keyValueStorage";
import { decodeBRouterProfiles, validateBRouterProfile } from "@/services/brouterProfiles";
import { generateId } from "@/utils/generateId";
import type { BRouterProfile } from "@/types";

let storage: KeyValueStorage | null = null;
function getStorage() {
  storage ??= createKeyValueStorage("brouter-profiles");
  return storage;
}

function readProfiles() {
  try {
    return decodeBRouterProfiles(getStorage().getString("profiles"));
  } catch {
    return decodeBRouterProfiles(undefined);
  }
}

interface BRouterProfileState {
  profiles: BRouterProfile[];
  selectedProfileId: string | null;
  saveProfile: (name: string, content: string, id?: string) => void;
  deleteProfile: (id: string) => void;
  selectProfile: (id: string | null) => void;
}

export const useBRouterProfileStore = create<BRouterProfileState>((set, get) => {
  const persist = (profiles: BRouterProfile[], selectedProfileId: string | null) => {
    // Commit to disk first: a failed write must not appear as a successful save.
    getStorage().set("profiles", JSON.stringify({ version: 1, profiles, selectedProfileId }));
    set({ profiles, selectedProfileId });
  };
  return {
    ...readProfiles(),
    saveProfile: (name, content, id) => {
      validateBRouterProfile(name, content);
      const { profiles, selectedProfileId } = get();
      if (id && !profiles.some((p) => p.id === id))
        throw new Error("This profile no longer exists.");
      const profile = { id: id ?? generateId(), name: name.trim(), content };
      persist(
        id ? profiles.map((p) => (p.id === id ? profile : p)) : [...profiles, profile],
        selectedProfileId,
      );
    },
    deleteProfile: (id) => {
      const { profiles, selectedProfileId } = get();
      persist(
        profiles.filter((p) => p.id !== id),
        selectedProfileId === id ? null : selectedProfileId,
      );
    },
    selectProfile: (id) => {
      const { profiles } = get();
      if (id !== null && !profiles.some((p) => p.id === id))
        throw new Error("This profile no longer exists.");
      persist(profiles, id);
    },
  };
});

export function getSelectedBRouterProfile(): BRouterProfile | null {
  const { profiles, selectedProfileId } = useBRouterProfileStore.getState();
  return profiles.find((p) => p.id === selectedProfileId) ?? null;
}
