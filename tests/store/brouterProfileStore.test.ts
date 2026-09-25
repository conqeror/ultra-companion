import { beforeEach, describe, expect, it, vi } from "vitest";
import { decodeBRouterProfiles } from "@/services/brouterProfiles";

const { disk, write } = vi.hoisted(() => ({ disk: new Map<string, string>(), write: vi.fn() }));
vi.mock("@/lib/keyValueStorage", () => ({
  createKeyValueStorage: () => ({ getString: (key: string) => disk.get(key), set: write }),
}));
import { useBRouterProfileStore } from "@/store/brouterProfileStore";
const state = () => useBRouterProfileStore.getState();

beforeEach(() => {
  disk.clear();
  write.mockReset().mockImplementation((key, value) => disk.set(key, value));
  useBRouterProfileStore.setState({ profiles: [], selectedProfileId: null });
});

describe("saved BRouter profiles", () => {
  it("persists names, exact source, and selection across store recreation", async () => {
    const source =
      "# comments and whitespace remain intact\n---context:way\nassign costfactor = 1\n";
    state().saveProfile("  Quiet roads  ", source);
    const profile = state().profiles[0];
    state().selectProfile(profile.id);
    vi.resetModules();
    const { useBRouterProfileStore: reopened } = await import("@/store/brouterProfileStore");
    expect(reopened.getState()).toMatchObject({
      profiles: [{ ...profile, name: "Quiet roads", content: source }],
      selectedProfileId: profile.id,
    });
  });

  it("edits a profile without changing its identity or selection", () => {
    state().saveProfile("Original", "source");
    const { id } = state().profiles[0];
    state().selectProfile(id);
    state().saveProfile("Renamed", "new source", id);
    expect(state()).toMatchObject({
      profiles: [{ id, name: "Renamed", content: "new source" }],
      selectedProfileId: id,
    });
  });

  it("falls back to the built-in profile when the selected custom profile is deleted", () => {
    state().saveProfile("One", "one");
    state().saveProfile("Two", "two");
    const [one, two] = state().profiles;
    state().selectProfile(two.id);
    state().deleteProfile(one.id);
    expect(state().selectedProfileId).toBe(two.id);
    state().deleteProfile(two.id);
    expect(decodeBRouterProfiles(disk.get("profiles"))).toEqual({
      profiles: [],
      selectedProfileId: null,
    });
  });

  it("retains the original profiles and selection on disk write failures", () => {
    state().saveProfile("Original", "source");
    const previous = state();
    write.mockImplementation(() => {
      throw new Error("Disk full");
    });
    expect(() => state().saveProfile("New", "new")).toThrow("Disk full");
    expect(() => state().deleteProfile(previous.profiles[0].id)).toThrow("Disk full");
    expect(() => state().selectProfile(previous.profiles[0].id)).toThrow("Disk full");
    expect(state().profiles).toBe(previous.profiles);
    expect(state().selectedProfileId).toBeNull();
  });

  it("rejects empty/oversized profiles and unknown edits or selections without writing", () => {
    for (const [name, content] of [
      [" ", "text"],
      ["Name", "\n"],
      ["Name", "x".repeat(100_001)],
      ["x".repeat(81), "source"],
    ]) {
      expect(() => state().saveProfile(name, content)).toThrow();
    }
    expect(() => state().selectProfile("missing")).toThrow();
    expect(() => state().saveProfile("Name", "source", "missing")).toThrow();
    expect(write).not.toHaveBeenCalled();
  });

  it("recovers valid records from corrupt storage and removes invalid selections", () => {
    const valid = { id: "p1", name: "Roads", content: "source" };
    const raw = JSON.stringify({
      version: 1,
      profiles: [null, valid, valid, { id: "p2", name: "", content: "text" }],
      selectedProfileId: "p2",
    });
    expect(decodeBRouterProfiles(raw)).toEqual({ profiles: [valid], selectedProfileId: null });
    expect(decodeBRouterProfiles("not json")).toEqual({ profiles: [], selectedProfileId: null });
    expect(decodeBRouterProfiles(JSON.stringify({ version: 9, profiles: [valid] }))).toEqual({
      profiles: [],
      selectedProfileId: null,
    });
  });
});
