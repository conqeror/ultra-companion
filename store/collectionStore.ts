import { create } from "zustand";
import {
  getAllCollections,
  insertCollection as dbInsertCollection,
  deleteCollection as dbDeleteCollection,
  renameCollection as dbRenameCollection,
  updateCollectionPlannedStart as dbUpdateCollectionPlannedStart,
  setActiveCollection as dbSetActiveCollection,
  insertCollectionSegment,
  deleteCollectionSegment as dbDeleteCollectionSegment,
  getCollectionSegments,
  selectVariant as dbSelectVariant,
  updateSegmentPositions as dbUpdateSegmentPositions,
  getMaxSegmentPosition,
  getRoute,
  getRouteEndpoints,
  getAllAssignedRouteIds,
  setRoutesVisible,
} from "@/db/database";
import { stitchCollection } from "@/services/stitchingService";
import { generateId } from "@/utils/generateId";
import { haversineDistance } from "@/utils/geo";
import type {
  Collection,
  CollectionSegment,
  CollectionSegmentWithRoute,
  StitchedCollection,
} from "@/types";

/** Max distance (meters) between start/end points to consider two routes as variants */
const VARIANT_THRESHOLD_M = 5_000;

interface CollectionState {
  collections: Collection[];
  activeStitchedCollection: StitchedCollection | null;
  /** Fingerprint of the currently-stitched collection (id + selected segments + positions).
   *  When the fingerprint matches, loadStitchedCollection can skip the re-stitch. */
  activeStitchedFingerprint: string | null;
  assignedRouteIds: Set<string>;
  isLoading: boolean;

  loadCollectionMetadata: () => Promise<void>;
  loadCollections: () => Promise<void>;
  createCollection: (name: string) => Promise<string>;
  deleteCollection: (id: string) => Promise<void>;
  renameCollection: (id: string, name: string) => Promise<void>;
  updateCollectionPlannedStart: (id: string, plannedStartMs: number | null) => Promise<void>;

  addSegment: (collectionId: string, routeId: string) => Promise<void>;
  removeSegment: (collectionId: string, routeId: string) => Promise<void>;
  selectVariant: (collectionId: string, routeId: string) => Promise<void>;

  setActiveCollection: (id: string) => Promise<void>;
  loadStitchedCollection: (id: string) => Promise<void>;
  clearActiveStitched: () => void;
  getCollectionSegmentsWithRoutes: (id: string) => Promise<CollectionSegmentWithRoute[]>;
}

function fingerprintSegments(collectionId: string, segments: CollectionSegment[]): string {
  const selected = segments
    .filter((s) => s.isSelected)
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((s) => `${s.position}:${s.routeId}`)
    .join(",");
  return `${collectionId}|${selected}`;
}

export const useCollectionStore = create<CollectionState>((set, get) => ({
  collections: [],
  activeStitchedCollection: null,
  activeStitchedFingerprint: null,
  assignedRouteIds: new Set<string>(),
  isLoading: false,

  loadCollectionMetadata: async () => {
    try {
      const [collections, assignedRouteIds] = await Promise.all([
        getAllCollections(),
        getAllAssignedRouteIds(),
      ]);
      set({ collections, assignedRouteIds });
      if (!collections.some((c) => c.isActive)) {
        set({ activeStitchedCollection: null, activeStitchedFingerprint: null });
      }
    } catch (e: any) {
      console.warn("Failed to load collections:", e);
    }
  },

  loadCollections: async () => {
    await get().loadCollectionMetadata();
    // If there's an active collection, load its stitched data. This is
    // fingerprint-cached, so unchanged collections short-circuit without
    // re-reading points.
    const active = get().collections.find((c) => c.isActive);
    if (active) {
      await get().loadStitchedCollection(active.id);
    }
  },

  createCollection: async (name) => {
    const id = generateId();
    const collection: Collection = {
      id,
      name,
      isActive: false,
      createdAt: new Date().toISOString(),
      plannedStartMs: null,
    };
    await dbInsertCollection(collection);
    await get().loadCollections();
    return id;
  },

  deleteCollection: async (id) => {
    await dbDeleteCollection(id);
    if (get().activeStitchedCollection?.collectionId === id) {
      set({ activeStitchedCollection: null, activeStitchedFingerprint: null });
    }
    await get().loadCollections();
  },

  renameCollection: async (id, name) => {
    await dbRenameCollection(id, name);
    await get().loadCollections();
  },

  updateCollectionPlannedStart: async (id, plannedStartMs) => {
    await dbUpdateCollectionPlannedStart(id, plannedStartMs);
    await get().loadCollections();
  },

  addSegment: async (collectionId, routeId) => {
    // Auto-detect if the new route is a variant of an existing segment
    // by comparing start/end points
    const newEndpoints = await getRouteEndpoints(routeId);
    let matchedPosition: number | null = null;

    if (newEndpoints) {
      const existingSegments = await getCollectionSegments(collectionId);
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
          newEndpoints.first.latitude,
          newEndpoints.first.longitude,
          endpoints.first.latitude,
          endpoints.first.longitude,
        );
        const endDist = haversineDistance(
          newEndpoints.last.latitude,
          newEndpoints.last.longitude,
          endpoints.last.latitude,
          endpoints.last.longitude,
        );
        if (startDist <= VARIANT_THRESHOLD_M && endDist <= VARIANT_THRESHOLD_M) {
          matchedPosition = pos;
          break;
        }
      }
    }

    if (matchedPosition != null) {
      // Add as unselected variant at the matched position
      await insertCollectionSegment({
        collectionId,
        routeId,
        position: matchedPosition,
        isSelected: false,
      });
    } else {
      // Add as new position at the end
      const maxPos = await getMaxSegmentPosition(collectionId);
      await insertCollectionSegment({
        collectionId,
        routeId,
        position: maxPos + 1,
        isSelected: true,
      });
      if (get().activeStitchedCollection?.collectionId === collectionId) {
        await get().loadStitchedCollection(collectionId);
      }
    }
    // Update assignedRouteIds immediately so route list reflects the change
    set({ assignedRouteIds: new Set([...get().assignedRouteIds, routeId]) });
  },

  removeSegment: async (collectionId, routeId) => {
    await dbDeleteCollectionSegment(collectionId, routeId);
    // Normalize positions: get remaining segments, re-number
    const segments = await getCollectionSegments(collectionId);
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
      await dbUpdateSegmentPositions(collectionId, updates);
    }
    // Ensure each position still has a selected variant
    const updatedSegments = await getCollectionSegments(collectionId);
    const positionSet = [...new Set(updatedSegments.map((s) => s.position))];
    for (const pos of positionSet) {
      const atPos = updatedSegments.filter((s) => s.position === pos);
      if (atPos.length > 0 && !atPos.some((s) => s.isSelected)) {
        await dbSelectVariant(collectionId, atPos[0].routeId);
      }
    }
    if (get().activeStitchedCollection?.collectionId === collectionId) {
      await get().loadStitchedCollection(collectionId);
    }
    // Refresh assignedRouteIds — route may still be in other collections
    const newAssigned = await getAllAssignedRouteIds();
    set({ assignedRouteIds: newAssigned });
  },

  selectVariant: async (collectionId, routeId) => {
    await dbSelectVariant(collectionId, routeId);
    if (get().activeStitchedCollection?.collectionId === collectionId) {
      await get().loadStitchedCollection(collectionId);
    }
  },

  setActiveCollection: async (id) => {
    set({ isLoading: true });
    await dbSetActiveCollection(id);
    // Make all selected segment routes visible in a single query
    const segments = await getCollectionSegments(id);
    const selectedRouteIds = segments.filter((s) => s.isSelected).map((s) => s.routeId);
    await setRoutesVisible(selectedRouteIds);
    // Reload route store to clear route isActive flags and pick up visibility changes
    const { useRouteStore } = await import("@/store/routeStore");
    const routeStore = useRouteStore.getState();
    routeStore.clearRouteProgress();
    await routeStore.loadRouteMetadata();
    await routeStore.loadRoutePoints([], { prune: true });
    await get().loadCollections();
    set({ isLoading: false });
  },

  loadStitchedCollection: async (id) => {
    try {
      // Check fingerprint first — if the selected segments haven't changed,
      // skip the re-stitch entirely (avoids re-loading all segment points).
      const segments = await getCollectionSegments(id);
      const fingerprint = fingerprintSegments(id, segments);
      if (
        get().activeStitchedFingerprint === fingerprint &&
        get().activeStitchedCollection?.collectionId === id
      ) {
        return;
      }

      const stitched = await stitchCollection(id, { includePointsByRouteId: false });
      set({ activeStitchedCollection: stitched, activeStitchedFingerprint: fingerprint });
    } catch (e: any) {
      console.warn("Failed to stitch collection:", e);
    }
  },

  clearActiveStitched: () =>
    set({ activeStitchedCollection: null, activeStitchedFingerprint: null }),

  getCollectionSegmentsWithRoutes: async (id) => {
    const segments = await getCollectionSegments(id);
    const routes = await Promise.all(segments.map((s) => getRoute(s.routeId)));
    const results: CollectionSegmentWithRoute[] = [];
    for (let i = 0; i < segments.length; i++) {
      const route = routes[i];
      if (route) {
        results.push({ segment: segments[i], route });
      }
    }
    return results;
  },
}));
