import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPlanningDatabaseFromBytes } from "@/services/planningTransportCore.web";

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

function createSourceDatabase() {
  return {
    closeAsync: vi.fn().mockResolvedValue(undefined),
    getAllAsync: vi.fn().mockResolvedValue([]),
    getFirstAsync: vi.fn().mockImplementation((query: string, params: unknown[] = []) => {
      if (query.includes("sqlite_master")) return Promise.resolve({ name: params[0] });
      if (params[0] === "transport_version") return Promise.resolve({ value: "1" });
      return Promise.resolve(null);
    }),
  };
}

function createTargetDatabase() {
  return {
    execAsync: vi.fn().mockResolvedValue(undefined),
    runAsync: vi.fn().mockResolvedValue(undefined),
    withTransactionAsync: vi.fn().mockImplementation(async (task: () => Promise<void>) => task()),
  };
}

describe("planningTransportCore.web", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseWebMocks.getWebSQLiteDatabase.mockResolvedValue(createTargetDatabase());
    databaseWebMocks.resetWebSQLiteDatabaseStorage.mockResolvedValue(undefined);
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
});
