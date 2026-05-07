import { vi } from "vitest";
import type {
  deletePOIsBySource,
  deletePOI,
  deletePOIsForRoute,
  deletePatchVariantsForBaseRoute,
  deleteRoute,
  getAllRoutes,
  getAllCollections,
  getAllAssignedRouteIds,
  getClimbsForRoute,
  getCollectionSegments,
  getPOICountsBySource,
  getPOIsForRoute,
  getStarredItems,
  getRoute,
  getRouteEndpoints,
  getRoutePoints,
  getRouteWithPoints,
  insertCollectionSegment,
  insertCollection,
  insertPOIs,
  insertRoute,
  setActiveRoute,
  setRoutesVisible,
  setActiveCollection,
  setStarredItem,
  updateClimbName,
  updatePOITags,
  updateRouteVisibility,
  updateSegmentPositions,
  renameCollection,
  deleteCollection,
  updateCollectionPlannedStart,
  getMaxSegmentPosition,
  selectVariant,
  deleteCollectionSegment,
} from "@/db/database";

export const databaseMocks = {
  deletePOI: vi.fn<typeof deletePOI>(),
  deletePOIsBySource: vi.fn<typeof deletePOIsBySource>(),
  deletePOIsForRoute: vi.fn<typeof deletePOIsForRoute>(),
  deletePatchVariantsForBaseRoute: vi.fn<typeof deletePatchVariantsForBaseRoute>(),
  deleteRoute: vi.fn<typeof deleteRoute>(),
  deleteCollection: vi.fn<typeof deleteCollection>(),
  deleteCollectionSegment: vi.fn<typeof deleteCollectionSegment>(),
  getAllRoutes: vi.fn<typeof getAllRoutes>(),
  getAllCollections: vi.fn<typeof getAllCollections>(),
  getAllAssignedRouteIds: vi.fn<typeof getAllAssignedRouteIds>(),
  getClimbsForRoute: vi.fn<typeof getClimbsForRoute>(),
  getCollectionSegments: vi.fn<typeof getCollectionSegments>(),
  getPOICountsBySource: vi.fn<typeof getPOICountsBySource>(),
  getPOIsForRoute: vi.fn<typeof getPOIsForRoute>(),
  getStarredItems: vi.fn<typeof getStarredItems>(),
  getRoute: vi.fn<typeof getRoute>(),
  getRouteEndpoints: vi.fn<typeof getRouteEndpoints>(),
  getRoutePoints: vi.fn<typeof getRoutePoints>(),
  getRouteWithPoints: vi.fn<typeof getRouteWithPoints>(),
  getMaxSegmentPosition: vi.fn<typeof getMaxSegmentPosition>(),
  insertCollection: vi.fn<typeof insertCollection>(),
  insertCollectionSegment: vi.fn<typeof insertCollectionSegment>(),
  insertPOIs: vi.fn<typeof insertPOIs>(),
  insertRoute: vi.fn<typeof insertRoute>(),
  setActiveRoute: vi.fn<typeof setActiveRoute>(),
  setActiveCollection: vi.fn<typeof setActiveCollection>(),
  setRoutesVisible: vi.fn<typeof setRoutesVisible>(),
  setStarredItem: vi.fn<typeof setStarredItem>(),
  updateClimbName: vi.fn<typeof updateClimbName>(),
  updatePOITags: vi.fn<typeof updatePOITags>(),
  updateRouteVisibility: vi.fn<typeof updateRouteVisibility>(),
  updateSegmentPositions: vi.fn<typeof updateSegmentPositions>(),
  updateCollectionPlannedStart: vi.fn<typeof updateCollectionPlannedStart>(),
  renameCollection: vi.fn<typeof renameCollection>(),
  selectVariant: vi.fn<typeof selectVariant>(),
};

export function resetDatabaseMocks(): void {
  databaseMocks.deletePOI.mockResolvedValue(undefined);
  databaseMocks.deletePOIsBySource.mockResolvedValue(undefined);
  databaseMocks.deletePOIsForRoute.mockResolvedValue(undefined);
  databaseMocks.deletePatchVariantsForBaseRoute.mockResolvedValue(undefined);
  databaseMocks.deleteRoute.mockResolvedValue(undefined);
  databaseMocks.deleteCollection.mockResolvedValue(undefined);
  databaseMocks.deleteCollectionSegment.mockResolvedValue(undefined);
  databaseMocks.getAllRoutes.mockResolvedValue([]);
  databaseMocks.getAllCollections.mockResolvedValue([]);
  databaseMocks.getAllAssignedRouteIds.mockResolvedValue(new Set());
  databaseMocks.getClimbsForRoute.mockResolvedValue([]);
  databaseMocks.getCollectionSegments.mockResolvedValue([]);
  databaseMocks.getPOICountsBySource.mockResolvedValue({ osm: 0, google: 0 });
  databaseMocks.getPOIsForRoute.mockResolvedValue([]);
  databaseMocks.getStarredItems.mockResolvedValue([]);
  databaseMocks.getRoute.mockResolvedValue(null);
  databaseMocks.getRouteEndpoints.mockResolvedValue(null);
  databaseMocks.getRoutePoints.mockResolvedValue([]);
  databaseMocks.getRouteWithPoints.mockResolvedValue(null);
  databaseMocks.getMaxSegmentPosition.mockResolvedValue(-1);
  databaseMocks.insertCollection.mockResolvedValue(undefined);
  databaseMocks.insertCollectionSegment.mockResolvedValue(undefined);
  databaseMocks.insertPOIs.mockResolvedValue(undefined);
  databaseMocks.insertRoute.mockResolvedValue(undefined);
  databaseMocks.setActiveRoute.mockResolvedValue(undefined);
  databaseMocks.setActiveCollection.mockResolvedValue(undefined);
  databaseMocks.setRoutesVisible.mockResolvedValue(undefined);
  databaseMocks.setStarredItem.mockResolvedValue(undefined);
  databaseMocks.updateClimbName.mockResolvedValue(undefined);
  databaseMocks.updatePOITags.mockResolvedValue(undefined);
  databaseMocks.updateRouteVisibility.mockResolvedValue(undefined);
  databaseMocks.updateSegmentPositions.mockResolvedValue(undefined);
  databaseMocks.updateCollectionPlannedStart.mockResolvedValue(undefined);
  databaseMocks.renameCollection.mockResolvedValue(undefined);
  databaseMocks.selectVariant.mockResolvedValue(undefined);
}
