import { create } from "zustand";
import type { Climb, StitchedSegmentInfo } from "@/types";
import { getClimbsForRoute, updateClimbName } from "@/db/database";

interface ClimbState {
  // Climb data per route
  climbs: Record<string, Climb[]>;

  // UI state
  selectedClimb: Climb | null;
  currentClimbId: string | null;
  isClimbZoomed: boolean;

  // Actions
  loadClimbs: (routeId: string) => Promise<void>;
  renameClimb: (climbId: string, routeId: string, name: string | null) => Promise<void>;
  setSelectedClimb: (climb: Climb | null) => void;
  setClimbZoomed: (zoomed: boolean) => void;
  clearClimbCache: () => void;

  // Computed
  getClimbsForDisplay: (routeIds: string[], segments: StitchedSegmentInfo[] | null) => Climb[];
  updateCurrentClimb: (distanceAlongRoute: number, routeIds: string[], segments: StitchedSegmentInfo[] | null) => void;
  getCurrentClimb: () => Climb | null;
}

export const useClimbStore = create<ClimbState>((set, get) => ({
  climbs: {},
  selectedClimb: null,
  currentClimbId: null,
  isClimbZoomed: false,

  loadClimbs: async (routeId) => {
    const existing = get().climbs[routeId];
    if (existing) return;
    const loaded = await getClimbsForRoute(routeId);
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
          [routeId]: routeClimbs.map((c) =>
            c.id === climbId ? { ...c, name } : c,
          ),
        },
      };
    });
  },

  setSelectedClimb: (climb) => set({ selectedClimb: climb }),
  setClimbZoomed: (zoomed) => set({ isClimbZoomed: zoomed }),
  clearClimbCache: () => set({ climbs: {} }),

  getClimbsForDisplay: (routeIds, segments) => {
    const state = get();

    if (segments && segments.length > 0) {
      // Collection mode — offset distances per segment
      const combined: Climb[] = [];
      for (const seg of segments) {
        const routeClimbs = state.climbs[seg.routeId];
        if (!routeClimbs) continue;
        for (const c of routeClimbs) {
          combined.push({
            ...c,
            startDistanceMeters: c.startDistanceMeters + seg.distanceOffsetMeters,
            endDistanceMeters: c.endDistanceMeters + seg.distanceOffsetMeters,
          });
        }
      }
      combined.sort((a, b) => a.startDistanceMeters - b.startDistanceMeters);
      return mergeAdjacentClimbs(combined, segments);
    }

    // Single route mode
    if (routeIds.length === 1) {
      return state.climbs[routeIds[0]] ?? [];
    }

    // Multiple routes (shouldn't happen outside collections, but handle gracefully)
    const all: Climb[] = [];
    for (const id of routeIds) {
      const routeClimbs = state.climbs[id];
      if (routeClimbs) all.push(...routeClimbs);
    }
    all.sort((a, b) => a.startDistanceMeters - b.startDistanceMeters);
    return all;
  },

  updateCurrentClimb: (distanceAlongRoute, routeIds, segments) => {
    const state = get();

    // Scan raw climb data without allocating intermediate arrays
    let newId: string | null = null;
    if (segments && segments.length > 0) {
      for (const seg of segments) {
        const routeClimbs = state.climbs[seg.routeId];
        if (!routeClimbs) continue;
        for (const c of routeClimbs) {
          const adjStart = c.startDistanceMeters + seg.distanceOffsetMeters;
          const adjEnd = c.endDistanceMeters + seg.distanceOffsetMeters;
          if (distanceAlongRoute >= adjStart && distanceAlongRoute <= adjEnd) {
            newId = c.id;
            break;
          }
        }
        if (newId) break;
      }
    } else if (routeIds.length >= 1) {
      const routeClimbs = state.climbs[routeIds[0]];
      const found = routeClimbs?.find(
        (c) => distanceAlongRoute >= c.startDistanceMeters && distanceAlongRoute <= c.endDistanceMeters,
      );
      if (found) newId = found.id;
    }

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
  sorted: Climb[],
  segments: StitchedSegmentInfo[],
): Climb[] {
  if (sorted.length <= 1 || segments.length <= 1) return sorted;

  // Build the set of interior junction distances (where segments meet)
  const junctions = new Set<number>();
  for (let i = 1; i < segments.length; i++) {
    junctions.add(segments[i].distanceOffsetMeters);
  }

  // First pass: identify which adjacent pairs should merge (no cascading)
  const mergeWithNext = new Array<boolean>(sorted.length).fill(false);

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];

    // Skip if already merging with a previous climb (prevent cascading)
    if (i > 0 && mergeWithNext[i - 1]) continue;

    // Check if there's a junction between the end of A and start of B
    // Only consider gaps < 5km — a real split climb wouldn't have a larger gap
    const gapStart = a.endDistanceMeters;
    const gapEnd = b.startDistanceMeters;
    if (gapEnd - gapStart > 5000) continue;

    let hasJunction = false;
    for (const j of junctions) {
      if (j >= gapStart - 1 && j <= gapEnd + 1) { hasJunction = true; break; }
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
  const result: Climb[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (mergeWithNext[i] && i + 1 < sorted.length) {
      const a = sorted[i];
      const b = sorted[i + 1];
      const mergedLength = b.endDistanceMeters - a.startDistanceMeters;
      const mergedAscent = a.totalAscentMeters + b.totalAscentMeters;
      result.push({
        ...a,
        id: `${a.id}_${b.id}`,
        name: a.name ?? b.name,
        endDistanceMeters: b.endDistanceMeters,
        endElevationMeters: b.endElevationMeters,
        lengthMeters: mergedLength,
        totalAscentMeters: mergedAscent,
        averageGradientPercent: Math.round(((mergedAscent / mergedLength) * 100) * 10) / 10,
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
