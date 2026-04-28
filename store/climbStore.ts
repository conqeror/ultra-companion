import { create } from "zustand";
import type { Climb, ClimbDifficulty, DisplayClimb, StitchedSegmentInfo } from "@/types";
import { getClimbsForRoute, updateClimbName } from "@/db/database";
import { MIN_GAIN_M } from "@/services/climbDetector";
import { toDisplayClimb, toDisplayClimbs } from "@/services/displayDistance";

interface ClimbState {
  // Climb data per route
  climbs: Record<string, Climb[]>;

  // UI state
  selectedClimb: DisplayClimb | null;
  currentClimbId: string | null;
  isClimbZoomed: boolean;
  minimumDifficulty: ClimbDifficulty;

  // Actions
  loadClimbs: (routeId: string) => Promise<void>;
  renameClimb: (climbId: string, routeId: string, name: string | null) => Promise<void>;
  setSelectedClimb: (climb: DisplayClimb | null) => void;
  setClimbZoomed: (zoomed: boolean) => void;
  setMinimumDifficulty: (difficulty: ClimbDifficulty) => void;
  clearClimbCache: () => void;

  // Computed
  getClimbsForDisplay: (
    routeIds: string[],
    segments: StitchedSegmentInfo[] | null,
  ) => DisplayClimb[];
  updateCurrentClimb: (
    distanceAlongRoute: number,
    routeIds: string[],
    segments: StitchedSegmentInfo[] | null,
  ) => void;
  getCurrentClimb: () => Climb | null;
}

export const useClimbStore = create<ClimbState>((set, get) => ({
  climbs: {},
  selectedClimb: null,
  currentClimbId: null,
  isClimbZoomed: false,
  minimumDifficulty: "low",

  loadClimbs: async (routeId) => {
    const existing = get().climbs[routeId];
    if (existing) return;
    let loaded = await getClimbsForRoute(routeId);

    // Self-heal: if stored climbs are empty but the route has meaningful
    // ascent, re-run detection. Catches routes whose climbs weren't persisted
    // at import (or were wiped) — the global version gate in
    // redetectClimbsIfNeeded won't retry individual routes once it's run.
    if (loaded.length === 0) {
      const { getRoute, getRoutePoints } = await import("@/db/database");
      const route = await getRoute(routeId);
      if (route && route.totalAscentMeters >= MIN_GAIN_M) {
        const points = await getRoutePoints(routeId);
        if (points.length >= 2) {
          const { detectAndStoreClimbs } = await import("@/services/climbDetector");
          loaded = await detectAndStoreClimbs(routeId, points);
        }
      }
    }

    set((s) => ({
      climbs: { ...s.climbs, [routeId]: loaded },
    }));
  },

  renameClimb: async (climbId, routeId, name) => {
    await updateClimbName(climbId, name);
    // Update in-memory cache
    set((s) => {
      const routeClimbs = s.climbs[routeId];
      if (!routeClimbs) return s;
      return {
        climbs: {
          ...s.climbs,
          [routeId]: routeClimbs.map((c) => {
            if (c.id !== climbId) return c;
            const out = Object.assign({}, c);
            out.name = name;
            return out;
          }),
        },
      };
    });
  },

  setSelectedClimb: (climb) => set({ selectedClimb: climb }),
  setClimbZoomed: (zoomed) => set({ isClimbZoomed: zoomed }),
  setMinimumDifficulty: (minimumDifficulty) => set({ minimumDifficulty, selectedClimb: null }),
  clearClimbCache: () => set({ climbs: {} }),

  getClimbsForDisplay: (routeIds, segments) => {
    const state = get();

    if (segments && segments.length > 0) {
      const combined: DisplayClimb[] = [];
      for (const seg of segments) {
        const routeClimbs = state.climbs[seg.routeId];
        if (!routeClimbs) continue;
        for (const c of routeClimbs) {
          combined.push(toDisplayClimb(c, seg.distanceOffsetMeters));
        }
      }
      combined.sort((a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters);
      return mergeAdjacentClimbs(combined, segments);
    }

    // Single route mode
    if (routeIds.length === 1) {
      return toDisplayClimbs(state.climbs[routeIds[0]] ?? []);
    }

    // Multiple routes (shouldn't happen outside collections, but handle gracefully)
    const all: DisplayClimb[] = [];
    for (const id of routeIds) {
      const routeClimbs = state.climbs[id];
      if (routeClimbs) all.push(...toDisplayClimbs(routeClimbs));
    }
    all.sort((a, b) => a.effectiveStartDistanceMeters - b.effectiveStartDistanceMeters);
    return all;
  },

  updateCurrentClimb: (distanceAlongRoute, routeIds, segments) => {
    const state = get();
    const found = state
      .getClimbsForDisplay(routeIds, segments)
      .find(
        (c) =>
          distanceAlongRoute >= c.effectiveStartDistanceMeters &&
          distanceAlongRoute <= c.effectiveEndDistanceMeters,
      );
    const newId = found?.id ?? null;

    if (newId !== state.currentClimbId) {
      set({
        currentClimbId: newId,
        isClimbZoomed: newId !== null,
      });
    }
  },

  getCurrentClimb: () => {
    const state = get();
    if (!state.currentClimbId) return null;
    for (const routeClimbs of Object.values(state.climbs)) {
      const found = routeClimbs.find((c) => c.id === state.currentClimbId);
      if (found) return found;
    }
    return null;
  },
}));

/**
 * Merge climbs at collection segment boundaries using the absorption rule.
 * Only merges pairs that directly straddle a junction — no cascading.
 */
function mergeAdjacentClimbs(
  sorted: DisplayClimb[],
  segments: StitchedSegmentInfo[],
): DisplayClimb[] {
  if (sorted.length <= 1 || segments.length <= 1) return sorted;

  // Build the set of interior junction distances (where segments meet)
  const junctions = new Set<number>();
  for (let i = 1; i < segments.length; i++) {
    junctions.add(segments[i].distanceOffsetMeters);
  }

  // First pass: identify which adjacent pairs should merge (no cascading)
  const mergeWithNext: boolean[] = Array.from({ length: sorted.length }, () => false);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];

    // Skip if already merging with a previous climb (prevent cascading)
    if (i > 0 && mergeWithNext[i - 1]) continue;

    // Check if there's a junction between the end of A and start of B
    // Only consider gaps < 5km — a real split climb wouldn't have a larger gap
    const gapStart = a.effectiveEndDistanceMeters;
    const gapEnd = b.effectiveStartDistanceMeters;
    if (gapEnd - gapStart > 5000) continue;

    let hasJunction = false;
    for (const j of junctions) {
      if (j >= gapStart - 1 && j <= gapEnd + 1) {
        hasJunction = true;
        break;
      }
    }
    if (!hasJunction) continue;

    // Apply absorption rule using net elevation gain of the first climb
    const gapDescent = Math.max(0, a.endElevationMeters - b.startElevationMeters);
    const netGain = a.endElevationMeters - a.startElevationMeters;
    const threshold = Math.max(10, 0.2 * netGain);

    if (gapDescent < threshold) {
      mergeWithNext[i] = true;
    }
  }

  // Second pass: build result by merging marked pairs
  const result: DisplayClimb[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (mergeWithNext[i] && i + 1 < sorted.length) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const mergedLength = b.effectiveEndDistanceMeters - a.effectiveStartDistanceMeters;
      const mergedAscent = a.totalAscentMeters + b.totalAscentMeters;
      result.push({
        ...a,
        id: `${a.id}_${b.id}`,
        name: a.name ?? b.name,
        endDistanceMeters: b.endDistanceMeters,
        effectiveEndDistanceMeters: b.effectiveEndDistanceMeters,
        endElevationMeters: b.endElevationMeters,
        lengthMeters: mergedLength,
        totalAscentMeters: mergedAscent,
        averageGradientPercent: Math.round((mergedAscent / mergedLength) * 100 * 10) / 10,
        maxGradientPercent: Math.max(a.maxGradientPercent, b.maxGradientPercent),
        difficultyScore: a.difficultyScore + b.difficultyScore,
      });
      i += 2; // skip the merged pair
    } else {
      result.push(sorted[i]);
      i++;
    }
  }

  return result;
}
