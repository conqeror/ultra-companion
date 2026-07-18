import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPlanningDatabaseExport,
  importPlanningDatabaseFromBytes,
  PLANNING_EXPORT_FILE_NAME,
  PLANNING_TRANSPORT_VERSION,
} from "@/services/planningTransportCore.web";

const sqliteMocks = vi.hoisted(() => ({
  deserializeDatabaseAsync: vi.fn(),
}));

const databaseWebMocks = vi.hoisted(() => ({
  getAllCollections: vi.fn(),
  getAllRoutes: vi.fn(),
  getPlanningMetadata: vi.fn(),
  getWebSQLiteDatabase: vi.fn(),
  resetWebSQLiteDatabaseStorage: vi.fn(),
  setPlanningMetadata: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  deserializeDatabaseAsync: sqliteMocks.deserializeDatabaseAsync,
}));

vi.mock("@/db/database.web", () => databaseWebMocks);

interface SourceDatabaseOptions {
  version?: 1 | 2;
  ferryTableExists?: boolean;
  ferries?: Record<string, unknown>[];
  routes?: Record<string, unknown>[];
}

function createSourceDatabase({
  version = 1,
  ferryTableExists = true,
  ferries = [],
  routes = [],
}: SourceDatabaseOptions = {}) {
  return {
    closeAsync: vi.fn().mockResolvedValue(undefined),
    getAllAsync: vi.fn().mockImplementation((query: string) => {
      if (query === "SELECT * FROM routes") return Promise.resolve(routes);
      if (query.includes("FROM ferry_crossings")) return Promise.resolve(ferries);
      if (query === "SELECT * FROM planning_metadata") {
        return Promise.resolve([
          {
            key: "transport_version",
            value: String(version),
            updatedAt: "2026-07-18T10:00:00.000Z",
          },
        ]);
      }
      return Promise.resolve([]);
    }),
    getFirstAsync: vi.fn().mockImplementation((query: string, params: unknown[] = []) => {
      if (query.includes("sqlite_master")) {
        if (params[0] === "ferry_crossings" && !ferryTableExists) return Promise.resolve(null);
        return Promise.resolve({ name: params[0] });
      }
      if (params[0] === "transport_version") {
        return Promise.resolve({ value: String(version) });
      }
      return Promise.resolve(null);
    }),
  };
}

function createTargetDatabase(serializedBytes = new Uint8Array([7, 8, 9])) {
  return {
    execAsync: vi.fn().mockResolvedValue(undefined),
    runAsync: vi.fn().mockResolvedValue(undefined),
    serializeAsync: vi.fn().mockResolvedValue(serializedBytes),
    withTransactionAsync: vi.fn().mockImplementation(async (task: () => Promise<void>) => task()),
  };
}

describe("planningTransportCore.web", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseWebMocks.getAllRoutes.mockResolvedValue([]);
    databaseWebMocks.getAllCollections.mockResolvedValue([]);
    databaseWebMocks.getPlanningMetadata.mockResolvedValue(null);
    databaseWebMocks.setPlanningMetadata.mockResolvedValue(undefined);
    databaseWebMocks.getWebSQLiteDatabase.mockResolvedValue(createTargetDatabase());
    databaseWebMocks.resetWebSQLiteDatabaseStorage.mockResolvedValue(undefined);
  });

  it("exports the current database as transport version 2", async () => {
    const bytes = new Uint8Array([4, 5, 6, 7]);
    const target = createTargetDatabase(bytes);
    databaseWebMocks.getAllRoutes.mockResolvedValue([{ id: "route-1" }]);
    databaseWebMocks.getAllCollections.mockResolvedValue([{ id: "collection-1" }]);
    databaseWebMocks.getWebSQLiteDatabase.mockResolvedValue(target);

    const result = await createPlanningDatabaseExport();

    expect(PLANNING_TRANSPORT_VERSION).toBe(2);
    expect(databaseWebMocks.setPlanningMetadata).toHaveBeenCalledWith("transport_version", "2");
    expect(target.execAsync).toHaveBeenCalledWith("PRAGMA wal_checkpoint(FULL);");
    expect(result).toEqual({
      routeCount: 1,
      collectionCount: 1,
      byteLength: bytes.byteLength,
      fileName: PLANNING_EXPORT_FILE_NAME,
      bytes,
    });
  });

  it("waits for the web SQLite database before deserializing imports", async () => {
    sqliteMocks.deserializeDatabaseAsync.mockResolvedValue(createSourceDatabase());

    await importPlanningDatabaseFromBytes(new Uint8Array([1, 2, 3]));

    expect(databaseWebMocks.getWebSQLiteDatabase).toHaveBeenCalled();
    expect(sqliteMocks.deserializeDatabaseAsync).toHaveBeenCalled();
    expect(databaseWebMocks.getWebSQLiteDatabase.mock.invocationCallOrder[0]).toBeLessThan(
      sqliteMocks.deserializeDatabaseAsync.mock.invocationCallOrder[0],
    );
  });

  it("retries source database deserialization after Expo web VFS races", async () => {
    sqliteMocks.deserializeDatabaseAsync
      .mockRejectedValueOnce(new Error("Invalid VFS state"))
      .mockResolvedValueOnce(createSourceDatabase());

    await importPlanningDatabaseFromBytes(new Uint8Array([1, 2, 3]));

    expect(sqliteMocks.deserializeDatabaseAsync).toHaveBeenCalledTimes(2);
    expect(databaseWebMocks.getWebSQLiteDatabase).toHaveBeenCalledTimes(3);
  });

  it("keeps version 1 imports compatible without reading a ferry table", async () => {
    const source = createSourceDatabase({ version: 1, ferryTableExists: false });
    sqliteMocks.deserializeDatabaseAsync.mockResolvedValue(source);

    const result = await importPlanningDatabaseFromBytes(new Uint8Array([1, 2, 3]));

    expect(result.ferries).toBe(0);
    expect(source.getAllAsync).not.toHaveBeenCalledWith(
      expect.stringContaining("ferry_crossings"),
      expect.anything(),
    );
  });

  it("requires the ferry table for version 2 imports", async () => {
    sqliteMocks.deserializeDatabaseAsync.mockResolvedValue(
      createSourceDatabase({ version: 2, ferryTableExists: false }),
    );

    await expect(importPlanningDatabaseFromBytes(new Uint8Array([1, 2, 3]))).rejects.toThrow(
      "Missing table: ferry_crossings",
    );
    expect(databaseWebMocks.resetWebSQLiteDatabaseStorage).not.toHaveBeenCalled();
  });

  it("replaces browser ferry rows and preserves ferry JSON fields on version 2 import", async () => {
    const encodedGeometry = "[[5,60],[5.1,60.05]]";
    const ferry = {
      id: "ferry-1",
      routeId: "route-1",
      name: "Brekstad-Valset",
      startDistanceMeters: 10_000,
      endDistanceMeters: 15_000,
      startLatitude: 63.686,
      startLongitude: 9.666,
      endLatitude: 63.638,
      endLongitude: 9.687,
      durationMinutes: 25,
      assumedWaitMinutes: 15,
      boardingBufferMinutes: 5,
      source: "osm",
      sourceId: "way/42",
      sourceUrl: "https://www.openstreetmap.org/way/42",
      operator: "AtB",
      timetableUrl: "https://example.com/timetable",
      bicycleAccess: "yes",
      providerRefs: JSON.stringify({
        enturQuayId: "NSR:Quay:1",
        osmGeometryV1: encodedGeometry,
      }),
      tags: { route: "ferry", bicycle: "yes" },
      createdAt: "2026-07-18T10:00:00.000Z",
      updatedAt: "2026-07-18T10:01:00.000Z",
    };
    const route = {
      id: "route-1",
      name: "Norway",
      fileName: "norway.gpx",
      color: "#123456",
      isActive: 1,
      isVisible: 1,
      totalDistanceMeters: 100_000,
      totalAscentMeters: 1_000,
      totalDescentMeters: 1_000,
      pointCount: 2,
      createdAt: "2026-07-18T09:00:00.000Z",
    };
    const source = createSourceDatabase({ version: 2, ferries: [ferry], routes: [route] });
    const target = createTargetDatabase();
    sqliteMocks.deserializeDatabaseAsync.mockResolvedValue(source);
    databaseWebMocks.getWebSQLiteDatabase.mockResolvedValue(target);

    const result = await importPlanningDatabaseFromBytes(new Uint8Array([1, 2, 3]));

    expect(result).toMatchObject({ routes: 1, ferries: 1 });
    expect(source.getAllAsync).toHaveBeenCalledWith(
      "SELECT * FROM ferry_crossings ORDER BY routeId, startDistanceMeters",
      [],
    );

    const deleteIndex = target.runAsync.mock.calls.findIndex(
      ([query]) => query === "DELETE FROM ferry_crossings",
    );
    const insertIndex = target.runAsync.mock.calls.findIndex(([query]) =>
      String(query).startsWith("INSERT INTO ferry_crossings"),
    );
    expect(deleteIndex).toBeGreaterThanOrEqual(0);
    expect(insertIndex).toBeGreaterThan(deleteIndex);

    const ferryInsertParams = target.runAsync.mock.calls[insertIndex]?.[1];
    expect(JSON.parse(ferryInsertParams?.[18] as string)).toEqual({
      enturQuayId: "NSR:Quay:1",
      osmGeometryV1: encodedGeometry,
    });
    expect(ferryInsertParams).toEqual([
      ferry.id,
      ferry.routeId,
      ferry.name,
      ferry.startDistanceMeters,
      ferry.endDistanceMeters,
      ferry.startLatitude,
      ferry.startLongitude,
      ferry.endLatitude,
      ferry.endLongitude,
      ferry.durationMinutes,
      ferry.assumedWaitMinutes,
      ferry.boardingBufferMinutes,
      ferry.source,
      ferry.sourceId,
      ferry.sourceUrl,
      ferry.operator,
      ferry.timetableUrl,
      ferry.bicycleAccess,
      ferry.providerRefs,
      JSON.stringify(ferry.tags),
      ferry.createdAt,
      ferry.updatedAt,
    ]);
  });
});
