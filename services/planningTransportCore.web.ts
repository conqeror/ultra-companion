import { deserializeDatabaseAsync, type SQLiteBindValue, type SQLiteDatabase } from "expo-sqlite";
import {
  getAllCollections,
  getAllRoutes,
  getPlanningMetadata,
  getWebSQLiteDatabase,
  setPlanningMetadata,
} from "@/db/database.web";
import { withQueuedTransaction } from "@/db/transactions.web";
import type { Climb, StarredItem } from "@/types";
import {
  PLANNING_TRANSPORT_VERSION,
  PLANNER_FETCHED_SOURCES_METADATA_KEY,
  PLANNING_EXPORT_FILE_NAME,
  PLANNING_METADATA_TABLE,
  REQUIRED_PLANNING_TABLES,
  normalizeSQLiteTransportBytes,
  normalizeRoute,
  normalizeCollection,
  normalizeCollectionSegment,
  normalizePOI,
  normalizeFerryCrossing,
  normalizeStarredItem,
  parsePlannerFetchedSources,
  parsePlanningTransportVersion,
} from "@/services/planningTransportFormat";
import type {
  RawRouteRow,
  RawCollectionRow,
  RawCollectionSegmentRow,
  RawPOIRow,
  RawStarredItemRow,
  RawFerryCrossingRow,
  ImportedRoutePoint,
  PlannerFetchedSourcePair,
  PlanningImportSummary,
  PlanningDatabaseExport,
} from "@/services/planningTransportFormat";
export {
  PLANNING_TRANSPORT_VERSION,
  PLANNER_FETCHED_SOURCES_METADATA_KEY,
  PLANNING_EXPORT_FILE_NAME,
  PLANNING_SQLITE_MIME_TYPE,
} from "@/services/planningTransportFormat";
export type {
  PlannerFetchedSourcePair,
  PlanningImportSummary,
  PlanningExportSummary,
  PlanningDatabaseExport,
} from "@/services/planningTransportFormat";

const INSERT_BATCH_SIZE = 100;
const SQLITE_VFS_RETRY_DELAY_MS = 75;
const SQLITE_VFS_READY_ATTEMPTS = 2;
const SQLITE_INVALID_VFS_STATE_MESSAGE = "Invalid VFS state";

interface RawPlanningMetadataRow {
  key: string;
  value: string;
  updatedAt: string;
}

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function chunk<T>(items: T[], size = INSERT_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isInvalidVfsStateError(error: unknown): boolean {
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.includes(SQLITE_INVALID_VFS_STATE_MESSAGE)) return true;
    current = current.cause;
  }
  return false;
}

async function tableExists(database: SQLiteDatabase, tableName: string): Promise<boolean> {
  const row = await database.getFirstAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  return row != null;
}

async function readMetadataValue(database: SQLiteDatabase, key: string): Promise<string | null> {
  return (
    (
      await database.getFirstAsync<{ value: string }>(
        `SELECT value FROM ${PLANNING_METADATA_TABLE} WHERE key = ?`,
        [key],
      )
    )?.value ?? null
  );
}

async function requirePlanningTransport(database: SQLiteDatabase): Promise<1 | 2> {
  for (const table of REQUIRED_PLANNING_TABLES) {
    if (!(await tableExists(database, table))) {
      throw new Error(`This is not an Ultra planning database. Missing table: ${table}`);
    }
  }

  const version = parsePlanningTransportVersion(
    await readMetadataValue(database, "transport_version"),
  );
  if (version >= 2 && !(await tableExists(database, "ferry_crossings"))) {
    throw new Error("This is not an Ultra planning database. Missing table: ferry_crossings");
  }
  return version;
}

async function selectAll<T>(
  database: SQLiteDatabase,
  query: string,
  params: SQLiteBindValue[] = [],
): Promise<T[]> {
  return database.getAllAsync<T>(query, params);
}

async function readPlannerFetchedSources(
  database: SQLiteDatabase,
): Promise<PlannerFetchedSourcePair[]> {
  return parsePlannerFetchedSources(
    await readMetadataValue(database, PLANNER_FETCHED_SOURCES_METADATA_KEY),
  );
}

async function ensureWebSQLiteDatabaseReady(): Promise<void> {
  for (let attempt = 1; attempt <= SQLITE_VFS_READY_ATTEMPTS; attempt += 1) {
    try {
      await getWebSQLiteDatabase();
      return;
    } catch (error) {
      if (!isInvalidVfsStateError(error) || attempt === SQLITE_VFS_READY_ATTEMPTS) {
        throw error;
      }
      await delay(SQLITE_VFS_RETRY_DELAY_MS);
    }
  }
}

async function openSerializedPlanningDatabase(sourceBytes: Uint8Array): Promise<SQLiteDatabase> {
  await ensureWebSQLiteDatabaseReady();
  try {
    return await deserializeDatabaseAsync(sourceBytes);
  } catch (error) {
    if (!isInvalidVfsStateError(error)) throw error;

    // Expo SQLite web initializes its persistent and memory VFS instances in a
    // shared worker without a lock. A direct deserialize can briefly race normal
    // app DB startup, so wait for the app DB path to finish initializing before retrying.
    await delay(SQLITE_VFS_RETRY_DELAY_MS);
    await ensureWebSQLiteDatabaseReady();
    return deserializeDatabaseAsync(sourceBytes);
  }
}

async function insertRows<T>(
  database: SQLiteDatabase,
  tableName: string,
  columns: string[],
  rows: T[],
  bind: (row: T) => SQLiteBindValue[],
): Promise<void> {
  if (rows.length === 0) return;

  const batchSize = Math.max(1, Math.floor(900 / columns.length));
  for (const rowChunk of chunk(rows, batchSize)) {
    const valuesSql = rowChunk.map(() => `(${placeholders(columns.length)})`).join(", ");
    const params = rowChunk.flatMap(bind);
    await database.runAsync(
      `INSERT INTO ${tableName} (${columns.join(", ")}) VALUES ${valuesSql}`,
      params,
    );
  }
}

async function withImportStage<T>(stage: string, task: () => Promise<T>): Promise<T> {
  try {
    console.info(`[planning-transport] ${stage}`);
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const wrapped = new Error(`${stage}: ${message}`);
    wrapped.cause = error;
    throw wrapped;
  }
}

export async function createPlanningDatabaseExport(): Promise<PlanningDatabaseExport> {
  const [allRoutes, allCollections] = await Promise.all([getAllRoutes(), getAllCollections()]);
  const routeIds = allRoutes.map((route) => route.id);
  const collectionIds = allCollections.map((collection) => collection.id);

  await setPlanningMetadata("transport_version", String(PLANNING_TRANSPORT_VERSION));
  await setPlanningMetadata("exported_at", new Date().toISOString());
  await setPlanningMetadata("export_scope", "all");
  await setPlanningMetadata("exported_route_ids", JSON.stringify(routeIds));
  await setPlanningMetadata("exported_collection_ids", JSON.stringify(collectionIds));
  if ((await getPlanningMetadata(PLANNER_FETCHED_SOURCES_METADATA_KEY)) == null) {
    await setPlanningMetadata(PLANNER_FETCHED_SOURCES_METADATA_KEY, "[]");
  }

  const database = await getWebSQLiteDatabase();
  await database.execAsync("PRAGMA wal_checkpoint(FULL);");
  const bytes = normalizeSQLiteTransportBytes(await database.serializeAsync());
  return {
    routeCount: routeIds.length,
    collectionCount: collectionIds.length,
    byteLength: bytes.byteLength,
    fileName: PLANNING_EXPORT_FILE_NAME,
    bytes,
  };
}

export async function importPlanningDatabaseFromBytes(
  bytes: Uint8Array,
): Promise<PlanningImportSummary> {
  const sourceBytes = normalizeSQLiteTransportBytes(bytes);
  const source = await withImportStage("open source planning database", () =>
    openSerializedPlanningDatabase(sourceBytes),
  );
  try {
    return await importPlanningDatabase(source);
  } finally {
    await withImportStage("close source planning database", () => source.closeAsync());
  }
}

export async function importPlanningDatabase(
  source: SQLiteDatabase,
): Promise<PlanningImportSummary> {
  const transportVersion = await withImportStage("validate planning database", () =>
    requirePlanningTransport(source),
  );

  const importedRoutes = (
    await withImportStage("read routes", () =>
      selectAll<RawRouteRow>(source, "SELECT * FROM routes"),
    )
  ).map(normalizeRoute);
  const importedRoutePoints = await withImportStage("read route points", () =>
    selectAll<ImportedRoutePoint>(source, "SELECT * FROM route_points ORDER BY routeId, idx"),
  );
  const importedCollections = (
    await withImportStage("read collections", () =>
      selectAll<RawCollectionRow>(source, "SELECT * FROM collections"),
    )
  ).map(normalizeCollection);
  const importedCollectionSegments = (
    await withImportStage("read collection segments", () =>
      selectAll<RawCollectionSegmentRow>(
        source,
        "SELECT * FROM collection_segments ORDER BY collectionId, position",
      ),
    )
  ).map(normalizeCollectionSegment);
  const importedPOIs = (
    await withImportStage("read POIs", () => selectAll<RawPOIRow>(source, "SELECT * FROM pois"))
  ).map(normalizePOI);
  const importedStarredItems = (
    await withImportStage("read starred POIs", () =>
      selectAll<RawStarredItemRow>(source, "SELECT * FROM starred_items WHERE entityType = 'poi'"),
    )
  )
    .map(normalizeStarredItem)
    .filter((item): item is StarredItem => item != null);
  const importedClimbs = await withImportStage("read climbs", () =>
    selectAll<Climb>(source, "SELECT * FROM climbs ORDER BY routeId, startDistanceMeters"),
  );
  const importedFerries =
    transportVersion >= 2
      ? (
          await withImportStage("read ferries", () =>
            selectAll<RawFerryCrossingRow>(
              source,
              "SELECT * FROM ferry_crossings ORDER BY routeId, startDistanceMeters",
            ),
          )
        ).map(normalizeFerryCrossing)
      : [];
  const importedMetadata = await withImportStage("read planning metadata", () =>
    selectAll<RawPlanningMetadataRow>(source, "SELECT * FROM planning_metadata"),
  );
  const fetchedPairs = await withImportStage("read fetched source metadata", () =>
    readPlannerFetchedSources(source),
  );

  // Replace the browser workspace in its existing transaction so any failed
  // write restores the previous plan. Deleting the database file first would
  // make rollback restore an empty workspace instead.
  const target = await withImportStage("open browser planning workspace", () =>
    getWebSQLiteDatabase(),
  );
  await withImportStage("write imported planning data", async () => {
    await target.execAsync("PRAGMA foreign_keys = ON;");
    await withQueuedTransaction(target, async () => {
      await target.runAsync("DELETE FROM relative_eta_cache");
      await target.runAsync("DELETE FROM starred_items");
      await target.runAsync("DELETE FROM climbs");
      await target.runAsync("DELETE FROM pois");
      await target.runAsync("DELETE FROM ferry_crossings");
      await target.runAsync("DELETE FROM collection_segments");
      await target.runAsync("DELETE FROM route_points");
      await target.runAsync("DELETE FROM collections");
      await target.runAsync("DELETE FROM routes");
      await target.runAsync("DELETE FROM planning_metadata");

      await insertRows(
        target,
        "routes",
        [
          "id",
          "name",
          "fileName",
          "color",
          "isActive",
          "isVisible",
          "totalDistanceMeters",
          "totalAscentMeters",
          "totalDescentMeters",
          "pointCount",
          "createdAt",
        ],
        importedRoutes,
        (route) => [
          route.id,
          route.name,
          route.fileName,
          route.color,
          boolToInt(route.isActive),
          boolToInt(route.isVisible),
          route.totalDistanceMeters,
          route.totalAscentMeters,
          route.totalDescentMeters,
          route.pointCount,
          route.createdAt,
        ],
      );

      await insertRows(
        target,
        "route_points",
        ["routeId", "idx", "latitude", "longitude", "elevationMeters", "distanceFromStartMeters"],
        importedRoutePoints,
        (point) => [
          point.routeId,
          point.idx,
          point.latitude,
          point.longitude,
          point.elevationMeters,
          point.distanceFromStartMeters,
        ],
      );

      await insertRows(
        target,
        "collections",
        ["id", "name", "isActive", "createdAt", "plannedStartMs"],
        importedCollections,
        (collection) => [
          collection.id,
          collection.name,
          boolToInt(collection.isActive),
          collection.createdAt,
          collection.plannedStartMs,
        ],
      );

      await insertRows(
        target,
        "collection_segments",
        [
          "collectionId",
          "routeId",
          "position",
          "isSelected",
          "variantKind",
          "baseRouteId",
          "replaceStartDistanceMeters",
          "replaceEndDistanceMeters",
        ],
        importedCollectionSegments,
        (segment) => [
          segment.collectionId,
          segment.routeId,
          segment.position,
          boolToInt(segment.isSelected),
          segment.variantKind,
          segment.baseRouteId,
          segment.replaceStartDistanceMeters,
          segment.replaceEndDistanceMeters,
        ],
      );

      await insertRows(
        target,
        "pois",
        [
          "id",
          "sourceId",
          "source",
          "routeId",
          "name",
          "category",
          "latitude",
          "longitude",
          "tags",
          "distanceFromRouteMeters",
          "distanceAlongRouteMeters",
        ],
        importedPOIs,
        (poi) => [
          poi.id,
          poi.sourceId,
          poi.source,
          poi.routeId,
          poi.name,
          poi.category,
          poi.latitude,
          poi.longitude,
          JSON.stringify(poi.tags),
          poi.distanceFromRouteMeters,
          poi.distanceAlongRouteMeters,
        ],
      );

      await insertRows(
        target,
        "starred_items",
        ["entityType", "entityId", "createdAt"],
        importedStarredItems,
        (item) => [item.entityType, item.entityId, item.createdAt],
      );

      await insertRows(
        target,
        "climbs",
        [
          "id",
          "routeId",
          "name",
          "startDistanceMeters",
          "endDistanceMeters",
          "lengthMeters",
          "totalAscentMeters",
          "startElevationMeters",
          "endElevationMeters",
          "averageGradientPercent",
          "maxGradientPercent",
          "difficultyScore",
        ],
        importedClimbs,
        (climb) => [
          climb.id,
          climb.routeId,
          climb.name,
          climb.startDistanceMeters,
          climb.endDistanceMeters,
          climb.lengthMeters,
          climb.totalAscentMeters,
          climb.startElevationMeters,
          climb.endElevationMeters,
          climb.averageGradientPercent,
          climb.maxGradientPercent,
          climb.difficultyScore,
        ],
      );

      await insertRows(
        target,
        "ferry_crossings",
        [
          "id",
          "routeId",
          "name",
          "startDistanceMeters",
          "endDistanceMeters",
          "startLatitude",
          "startLongitude",
          "endLatitude",
          "endLongitude",
          "durationMinutes",
          "assumedWaitMinutes",
          "boardingBufferMinutes",
          "source",
          "sourceId",
          "sourceUrl",
          "operator",
          "timetableUrl",
          "bicycleAccess",
          "providerRefs",
          "tags",
          "createdAt",
          "updatedAt",
        ],
        importedFerries,
        (ferry) => [
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
          JSON.stringify(ferry.providerRefs),
          JSON.stringify(ferry.tags),
          ferry.createdAt,
          ferry.updatedAt,
        ],
      );

      await insertRows(
        target,
        "planning_metadata",
        ["key", "value", "updatedAt"],
        importedMetadata,
        (metadata) => [metadata.key, metadata.value, metadata.updatedAt],
      );
    });
  });

  return {
    routes: importedRoutes.length,
    collections: importedCollections.length,
    pois: importedPOIs.length,
    starredItems: importedStarredItems.length,
    climbs: importedClimbs.length,
    ferries: importedFerries.length,
    replacedFetchedSources: fetchedPairs.length,
  };
}
