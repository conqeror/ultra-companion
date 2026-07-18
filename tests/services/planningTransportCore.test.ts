import { beforeEach, describe, expect, it, vi } from "vitest";
import { ferryCrossings } from "@/db/schema";

const transactionMocks = vi.hoisted(() => {
  const deleteRun = vi.fn();
  const deleteWhere = vi.fn(() => ({ run: deleteRun }));
  const deleteFrom = vi.fn(() => ({ where: deleteWhere, run: deleteRun }));

  const insertRun = vi.fn();
  const onConflictDoUpdate = vi.fn(() => ({ run: insertRun }));
  const onConflictDoNothing = vi.fn(() => ({ run: insertRun }));
  const insertValues = vi.fn(() => ({
    onConflictDoUpdate,
    onConflictDoNothing,
    run: insertRun,
  }));
  const insertInto = vi.fn(() => ({ values: insertValues }));

  const updateRun = vi.fn();
  const updateWhere = vi.fn(() => ({ run: updateRun }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  const update = vi.fn(() => ({ set: updateSet }));

  return {
    deleteFrom,
    deleteWhere,
    deleteRun,
    insertInto,
    insertValues,
    insertRun,
    onConflictDoUpdate,
    onConflictDoNothing,
    update,
    updateSet,
    updateWhere,
    updateRun,
  };
});

const databaseMocks = vi.hoisted(() => ({
  appSQLiteDb: {
    getAllSync: vi.fn().mockReturnValue([]),
    getFirstSync: vi.fn().mockReturnValue(null),
    execSync: vi.fn(),
    serializeSync: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
  },
  db: {
    transaction: vi.fn((task: (tx: unknown) => void) =>
      task({
        delete: transactionMocks.deleteFrom,
        insert: transactionMocks.insertInto,
        update: transactionMocks.update,
      }),
    ),
  },
  getAllCollections: vi.fn().mockResolvedValue([]),
  getAllRoutes: vi.fn().mockResolvedValue([]),
  setPlanningMetadata: vi.fn(),
}));

vi.mock("expo-sqlite", () => ({
  deserializeDatabaseSync: vi.fn(),
}));

vi.mock("@/db/database", () => databaseMocks);

import { importPlanningDatabase } from "@/services/planningTransportCore";

interface SourceDatabaseOptions {
  version: 1 | 2;
  ferries?: Record<string, unknown>[];
}

function createSourceDatabase({ version, ferries = [] }: SourceDatabaseOptions) {
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

  return {
    getFirstSync: vi.fn().mockImplementation((query: string, params: unknown[] = []) => {
      if (query.includes("sqlite_master")) return { name: params[0] };
      if (params[0] === "transport_version") return { value: String(version) };
      return null;
    }),
    getAllSync: vi.fn().mockImplementation((query: string) => {
      if (query === "SELECT * FROM routes") return [route];
      if (query.includes("FROM ferry_crossings")) return ferries;
      return [];
    }),
  };
}

describe("planningTransportCore native ferry imports", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.appSQLiteDb.getAllSync.mockReturnValue([]);
    databaseMocks.appSQLiteDb.getFirstSync.mockReturnValue(null);
  });

  it("preserves local ferry rows when importing a legacy version 1 database", () => {
    const source = createSourceDatabase({ version: 1 });

    const result = importPlanningDatabase(source as never);

    expect(result).toMatchObject({ routes: 1, ferries: 0 });
    expect(source.getAllSync).not.toHaveBeenCalledWith(
      expect.stringContaining("ferry_crossings"),
      expect.anything(),
    );
    expect(transactionMocks.deleteFrom).not.toHaveBeenCalledWith(ferryCrossings);
  });

  it("replaces imported-route ferry rows and normalizes JSON fields for version 2", () => {
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
      tags: JSON.stringify({ route: "ferry", bicycle: "yes" }),
      createdAt: "2026-07-18T10:00:00.000Z",
      updatedAt: "2026-07-18T10:01:00.000Z",
    };
    const source = createSourceDatabase({ version: 2, ferries: [ferry] });

    const result = importPlanningDatabase(source as never);

    expect(result).toMatchObject({ routes: 1, ferries: 1 });
    expect(transactionMocks.deleteFrom).toHaveBeenCalledWith(ferryCrossings);

    const insertIntoCalls = transactionMocks.insertInto.mock.calls as unknown[][];
    const insertValuesCalls = transactionMocks.insertValues.mock.calls as unknown[][];
    const ferryInsertIndex = insertIntoCalls.findIndex(([table]) => table === ferryCrossings);
    expect(ferryInsertIndex).toBeGreaterThanOrEqual(0);
    expect(insertValuesCalls[ferryInsertIndex]?.[0]).toEqual([
      {
        ...ferry,
        providerRefs: {
          enturQuayId: "NSR:Quay:1",
          osmGeometryV1: encodedGeometry,
        },
        tags: { route: "ferry", bicycle: "yes" },
      },
    ]);
  });
});
