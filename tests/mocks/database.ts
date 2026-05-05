import { vi } from "vitest";
import type {
  deletePOIsBySource,
  deletePOI,
  deletePOIsForRoute,
  deleteRoute,
  getAllRoutes,
  getClimbsForRoute,
  getCollectionSegments,
  getPOICountsBySource,
  getPOIsForRoute,
  getStarredItems,
  getRoute,
  getRoutePoints,
  getRouteWithPoints,
  insertPOIs,
  insertRoute,
  setActiveRoute,
  setStarredItem,
  updateClimbName,
  updatePOITags,
  updateRouteVisibility,
} from "@/db/database";

export const databaseMocks = {
  deletePOI: vi.fn<typeof deletePOI>(),
  deletePOIsBySource: vi.fn<typeof deletePOIsBySource>(),
  deletePOIsForRoute: vi.fn<typeof deletePOIsForRoute>(),
  deleteRoute: vi.fn<typeof deleteRoute>(),
  getAllRoutes: vi.fn<typeof getAllRoutes>(),
  getClimbsForRoute: vi.fn<typeof getClimbsForRoute>(),
  getCollectionSegments: vi.fn<typeof getCollectionSegments>(),
  getPOICountsBySource: vi.fn<typeof getPOICountsBySource>(),
  getPOIsForRoute: vi.fn<typeof getPOIsForRoute>(),
  getStarredItems: vi.fn<typeof getStarredItems>(),
  getRoute: vi.fn<typeof getRoute>(),
  getRoutePoints: vi.fn<typeof getRoutePoints>(),
  getRouteWithPoints: vi.fn<typeof getRouteWithPoints>(),
  insertPOIs: vi.fn<typeof insertPOIs>(),
  insertRoute: vi.fn<typeof insertRoute>(),
  setActiveRoute: vi.fn<typeof setActiveRoute>(),
  setStarredItem: vi.fn<typeof setStarredItem>(),
  updateClimbName: vi.fn<typeof updateClimbName>(),
  updatePOITags: vi.fn<typeof updatePOITags>(),
  updateRouteVisibility: vi.fn<typeof updateRouteVisibility>(),
};

export function resetDatabaseMocks(): void {
  databaseMocks.deletePOI.mockResolvedValue(undefined);
  databaseMocks.deletePOIsBySource.mockResolvedValue(undefined);
  databaseMocks.deletePOIsForRoute.mockResolvedValue(undefined);
  databaseMocks.deleteRoute.mockResolvedValue(undefined);
  databaseMocks.getAllRoutes.mockResolvedValue([]);
  databaseMocks.getClimbsForRoute.mockResolvedValue([]);
  databaseMocks.getCollectionSegments.mockResolvedValue([]);
  databaseMocks.getPOICountsBySource.mockResolvedValue({ osm: 0, google: 0 });
  databaseMocks.getPOIsForRoute.mockResolvedValue([]);
  databaseMocks.getStarredItems.mockResolvedValue([]);
  databaseMocks.getRoute.mockResolvedValue(null);
  databaseMocks.getRoutePoints.mockResolvedValue([]);
  databaseMocks.getRouteWithPoints.mockResolvedValue(null);
  databaseMocks.insertPOIs.mockResolvedValue(undefined);
  databaseMocks.insertRoute.mockResolvedValue(undefined);
  databaseMocks.setActiveRoute.mockResolvedValue(undefined);
  databaseMocks.setStarredItem.mockResolvedValue(undefined);
  databaseMocks.updateClimbName.mockResolvedValue(undefined);
  databaseMocks.updatePOITags.mockResolvedValue(undefined);
  databaseMocks.updateRouteVisibility.mockResolvedValue(undefined);
}
