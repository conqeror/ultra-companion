import { vi } from "vitest";
import type {
  deletePOIsBySource,
  deletePOIsForRoute,
  getClimbsForRoute,
  getCollectionSegments,
  getPOICountsBySource,
  getPOIsForRoute,
  getRoute,
  getRoutePoints,
  getRouteWithPoints,
  updateClimbName,
} from "@/db/database";

export const databaseMocks = {
  deletePOIsBySource: vi.fn<typeof deletePOIsBySource>(),
  deletePOIsForRoute: vi.fn<typeof deletePOIsForRoute>(),
  getClimbsForRoute: vi.fn<typeof getClimbsForRoute>(),
  getCollectionSegments: vi.fn<typeof getCollectionSegments>(),
  getPOICountsBySource: vi.fn<typeof getPOICountsBySource>(),
  getPOIsForRoute: vi.fn<typeof getPOIsForRoute>(),
  getRoute: vi.fn<typeof getRoute>(),
  getRoutePoints: vi.fn<typeof getRoutePoints>(),
  getRouteWithPoints: vi.fn<typeof getRouteWithPoints>(),
  updateClimbName: vi.fn<typeof updateClimbName>(),
};

export function resetDatabaseMocks(): void {
  databaseMocks.deletePOIsBySource.mockResolvedValue(undefined);
  databaseMocks.deletePOIsForRoute.mockResolvedValue(undefined);
  databaseMocks.getClimbsForRoute.mockResolvedValue([]);
  databaseMocks.getCollectionSegments.mockResolvedValue([]);
  databaseMocks.getPOICountsBySource.mockResolvedValue({ osm: 0, google: 0 });
  databaseMocks.getPOIsForRoute.mockResolvedValue([]);
  databaseMocks.getRoute.mockResolvedValue(null);
  databaseMocks.getRoutePoints.mockResolvedValue([]);
  databaseMocks.getRouteWithPoints.mockResolvedValue(null);
  databaseMocks.updateClimbName.mockResolvedValue(undefined);
}
