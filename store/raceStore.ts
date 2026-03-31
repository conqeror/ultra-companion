import { create } from "zustand";
import {
  getAllRaces,
  insertRace as dbInsertRace,
  deleteRace as dbDeleteRace,
  renameRace as dbRenameRace,
  setActiveRace as dbSetActiveRace,
  insertRaceSegment,
  deleteRaceSegment as dbDeleteRaceSegment,
  getRaceSegments,
  selectVariant as dbSelectVariant,
  updateSegmentPositions as dbUpdateSegmentPositions,
  getMaxSegmentPosition,
  getRoute,
  getRouteEndpoints,
  getAllAssignedRouteIds,
  setRoutesVisible,
} from "@/db/database";
import { stitchRace } from "@/services/stitchingService";
import { generateId } from "@/utils/generateId";
import { haversineDistance } from "@/utils/geo";
import type { Race, RaceSegment, RaceSegmentWithRoute, RoutePoint, StitchedRace } from "@/types";

/** Max distance (meters) between start/end points to consider two routes as variants */
const VARIANT_THRESHOLD_M = 5_000;

interface RaceState {
  races: Race[];
  activeStitchedRace: StitchedRace | null;
  assignedRouteIds: Set<string>;
  isLoading: boolean;

  loadRaces: () => Promise<void>;
  createRace: (name: string) => Promise<string>;
  deleteRace: (id: string) => Promise<void>;
  renameRace: (id: string, name: string) => Promise<void>;

  addSegment: (raceId: string, routeId: string) => Promise<void>;
  removeSegment: (raceId: string, routeId: string) => Promise<void>;
  selectVariant: (raceId: string, routeId: string) => Promise<void>;

  setActiveRace: (id: string) => Promise<void>;
  loadStitchedRace: (id: string) => Promise<void>;
  clearActiveStitched: () => void;
  getRaceSegmentsWithRoutes: (id: string) => Promise<RaceSegmentWithRoute[]>;
}

export const useRaceStore = create<RaceState>((set, get) => ({
  races: [],
  activeStitchedRace: null,
  assignedRouteIds: new Set<string>(),
  isLoading: false,

  loadRaces: async () => {
    try {
      const [races, assignedRouteIds] = await Promise.all([
        getAllRaces(),
        getAllAssignedRouteIds(),
      ]);
      set({ races, assignedRouteIds });
      // If there's an active race, load its stitched data
      const active = races.find((r) => r.isActive);
      if (active) {
        await get().loadStitchedRace(active.id);
      } else {
        set({ activeStitchedRace: null });
      }
    } catch (e: any) {
      console.warn("Failed to load races:", e);
    }
  },

  createRace: async (name) => {
    const id = generateId();
    const race: Race = {
      id,
      name,
      isActive: false,
      createdAt: new Date().toISOString(),
    };
    await dbInsertRace(race);
    await get().loadRaces();
    return id;
  },

  deleteRace: async (id) => {
    await dbDeleteRace(id);
    if (get().activeStitchedRace?.raceId === id) {
      set({ activeStitchedRace: null });
    }
    await get().loadRaces();
  },

  renameRace: async (id, name) => {
    await dbRenameRace(id, name);
    await get().loadRaces();
  },

  addSegment: async (raceId, routeId) => {
    // Auto-detect if the new route is a variant of an existing segment
    // by comparing start/end points
    const newEndpoints = await getRouteEndpoints(routeId);
    let matchedPosition: number | null = null;

    if (newEndpoints) {
      const existingSegments = await getRaceSegments(raceId);
      const selectedByPosition = new Map<number, string>();
      for (const seg of existingSegments) {
        if (seg.isSelected && !selectedByPosition.has(seg.position)) {
          selectedByPosition.set(seg.position, seg.routeId);
        }
      }

      // Check each position's selected segment for start/end proximity
      const checks = await Promise.all(
        [...selectedByPosition.entries()].map(async ([pos, rid]) => ({
          pos,
          endpoints: await getRouteEndpoints(rid),
        })),
      );

      for (const { pos, endpoints } of checks) {
        if (!endpoints) continue;
        const startDist = haversineDistance(
          newEndpoints.first.latitude, newEndpoints.first.longitude,
          endpoints.first.latitude, endpoints.first.longitude,
        );
        const endDist = haversineDistance(
          newEndpoints.last.latitude, newEndpoints.last.longitude,
          endpoints.last.latitude, endpoints.last.longitude,
        );
        if (startDist <= VARIANT_THRESHOLD_M && endDist <= VARIANT_THRESHOLD_M) {
          matchedPosition = pos;
          break;
        }
      }
    }

    if (matchedPosition != null) {
      // Add as unselected variant at the matched position
      await insertRaceSegment({
        raceId,
        routeId,
        position: matchedPosition,
        isSelected: false,
      });
    } else {
      // Add as new position at the end
      const maxPos = await getMaxSegmentPosition(raceId);
      await insertRaceSegment({
        raceId,
        routeId,
        position: maxPos + 1,
        isSelected: true,
      });
      if (get().activeStitchedRace?.raceId === raceId) {
        await get().loadStitchedRace(raceId);
      }
    }
    // Update assignedRouteIds immediately so route list reflects the change
    set({ assignedRouteIds: new Set([...get().assignedRouteIds, routeId]) });
  },

  removeSegment: async (raceId, routeId) => {
    await dbDeleteRaceSegment(raceId, routeId);
    // Normalize positions: get remaining segments, re-number
    const segments = await getRaceSegments(raceId);
    const positions = [...new Set(segments.map((s) => s.position))].sort((a, b) => a - b);
    const updates: { routeId: string; position: number }[] = [];
    for (let i = 0; i < positions.length; i++) {
      const segsAtPos = segments.filter((s) => s.position === positions[i]);
      for (const seg of segsAtPos) {
        if (seg.position !== i) {
          updates.push({ routeId: seg.routeId, position: i });
        }
      }
    }
    if (updates.length > 0) {
      await dbUpdateSegmentPositions(raceId, updates);
    }
    // Ensure each position still has a selected variant
    const updatedSegments = await getRaceSegments(raceId);
    const positionSet = [...new Set(updatedSegments.map((s) => s.position))];
    for (const pos of positionSet) {
      const atPos = updatedSegments.filter((s) => s.position === pos);
      if (atPos.length > 0 && !atPos.some((s) => s.isSelected)) {
        await dbSelectVariant(raceId, atPos[0].routeId);
      }
    }
    if (get().activeStitchedRace?.raceId === raceId) {
      await get().loadStitchedRace(raceId);
    }
    // Refresh assignedRouteIds — route may still be in other races
    const newAssigned = await getAllAssignedRouteIds();
    set({ assignedRouteIds: newAssigned });
  },

  selectVariant: async (raceId, routeId) => {
    await dbSelectVariant(raceId, routeId);
    if (get().activeStitchedRace?.raceId === raceId) {
      await get().loadStitchedRace(raceId);
    }
  },

  setActiveRace: async (id) => {
    set({ isLoading: true });
    await dbSetActiveRace(id);
    // Make all selected segment routes visible in a single query
    const segments = await getRaceSegments(id);
    const selectedRouteIds = segments.filter((s) => s.isSelected).map((s) => s.routeId);
    await setRoutesVisible(selectedRouteIds);
    // Reload route store to clear route isActive flags and pick up visibility changes
    const { useRouteStore } = await import("@/store/routeStore");
    await useRouteStore.getState().loadRoutes();
    await get().loadRaces();
    set({ isLoading: false });
  },

  loadStitchedRace: async (id) => {
    try {
      const stitched = await stitchRace(id);
      set({ activeStitchedRace: stitched });
      // Inject stitched + per-segment points into routeStore so etaStore and RouteLayer work
      const { useRouteStore } = await import("@/store/routeStore");
      const current = { ...useRouteStore.getState().visibleRoutePoints };
      current[id] = stitched.points;
      for (const [routeId, points] of Object.entries(stitched.pointsByRouteId)) {
        current[routeId] = points;
      }
      useRouteStore.setState({ visibleRoutePoints: current });
    } catch (e: any) {
      console.warn("Failed to stitch race:", e);
    }
  },

  clearActiveStitched: () => set({ activeStitchedRace: null }),

  getRaceSegmentsWithRoutes: async (id) => {
    const segments = await getRaceSegments(id);
    const routes = await Promise.all(segments.map((s) => getRoute(s.routeId)));
    const results: RaceSegmentWithRoute[] = [];
    for (let i = 0; i < segments.length; i++) {
      const route = routes[i];
      if (route) {
        results.push({ segment: segments[i], route });
      }
    }
    return results;
  },
}));
