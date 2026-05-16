import { deserializeDatabaseSync, type SQLiteBindValue, type SQLiteDatabase } from "expo-sqlite";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  appSQLiteDb,
  db,
  getAllCollections,
  getAllRoutes,
  setPlanningMetadata,
} from "@/db/database";
import {
  climbs,
  collectionSegments,
  collections,
  pois,
  routePoints,
  routes,
  starredItems,
} from "@/db/schema";
import type {
  Climb,
  Collection,
  CollectionSegment,
  POI,
  POIFetchedSource,
  POISource,
  Route,
  RoutePoint,
  StarredItem,
} from "@/types";

export const PLANNING_TRANSPORT_VERSION = 1;
export const PLANNER_FETCHED_SOURCES_METADATA_KEY = "planner_fetched_sources";
export const PLANNING_EXPORT_FILE_NAME = "ultra-plan.ultra-plan.db";
export const PLANNING_SQLITE_MIME_TYPE = "application/x-sqlite3";

const METADATA_TABLE = "planning_metadata";
const CHUNK_SIZE = 500;
const SQLITE_HEADER_BYTES = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
];
const SQLITE_WRITE_VERSION_OFFSET = 18;
const SQLITE_READ_VERSION_OFFSET = 19;
const SQLITE_ROLLBACK_JOURNAL_VERSION = 1;
const SQLITE_WAL_JOURNAL_VERSION = 2;

type RawBoolean = boolean | number;

interface RawRouteRow extends Omit<Route, "isActive" | "isVisible"> {
  isActive: RawBoolean;
  isVisible: RawBoolean;
}

interface RawCollectionRow extends Omit<Collection, "isActive"> {
  isActive: RawBoolean;
}

interface RawCollectionSegmentRow extends Omit<CollectionSegment, "isSelected" | "variantKind"> {
  isSelected: RawBoolean;
  variantKind: string;
}

interface RawPOIRow extends Omit<POI, "source" | "category" | "tags"> {
  source: string;
  category: string;
  tags: string | Record<string, string>;
}

interface RawStarredItemRow extends Omit<StarredItem, "entityType"> {
  entityType: string;
}

interface RawClimbRow extends Climb {}

type ImportedRoutePoint = RoutePoint & { routeId: string };

export interface PlannerFetchedSourcePair {
  routeId: string;
  source: POIFetchedSource;
}

export interface PlanningImportSummary {
  routes: number;
  collections: number;
  pois: number;
  starredItems: number;
  climbs: number;
  replacedFetchedSources: number;
}

export interface PlanningExportSummary {
  routeCount: number;
  collectionCount: number;
  byteLength: number;
  fileName: string;
}

export interface PlanningDatabaseExport extends PlanningExportSummary {
  bytes: Uint8Array;
}

function toBoolean(value: RawBoolean): boolean {
  return value === true || value === 1;
}

function isSQLiteDatabaseBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 100 &&
    SQLITE_HEADER_BYTES.every((expectedByte, index) => bytes[index] === expectedByte)
  );
}

function normalizeSQLiteTransportBytes(bytes: Uint8Array): Uint8Array {
  if (!isSQLiteDatabaseBytes(bytes)) return bytes;

  const isWalDatabase =
    bytes[SQLITE_WRITE_VERSION_OFFSET] === SQLITE_WAL_JOURNAL_VERSION ||
    bytes[SQLITE_READ_VERSION_OFFSET] === SQLITE_WAL_JOURNAL_VERSION;
  if (!isWalDatabase) return bytes;

  const normalizedBytes = new Uint8Array(bytes);
  normalizedBytes[SQLITE_WRITE_VERSION_OFFSET] = SQLITE_ROLLBACK_JOURNAL_VERSION;
  normalizedBytes[SQLITE_READ_VERSION_OFFSET] = SQLITE_ROLLBACK_JOURNAL_VERSION;
  return normalizedBytes;
}

function parseTags(value: RawPOIRow["tags"]): Record<string, string> {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
  } catch {}
  return {};
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isFetchedSource(value: string): value is POIFetchedSource {
  return value === "osm" || value === "google";
}

function pairKey(pair: PlannerFetchedSourcePair): string {
  return `${pair.routeId}:${pair.source}`;
}

function tableExists(database: SQLiteDatabase, tableName: string): boolean {
  const row = database.getFirstSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName],
  );
  return row != null;
}

function readMetadataValue(database: SQLiteDatabase, key: string): string | null {
  return (
    database.getFirstSync<{ value: string }>(`SELECT value FROM ${METADATA_TABLE} WHERE key = ?`, [
      key,
    ])?.value ?? null
  );
}

function requirePlanningTransport(database: SQLiteDatabase): void {
  for (const table of [
    METADATA_TABLE,
    "routes",
    "route_points",
    "collections",
    "collection_segments",
    "pois",
    "starred_items",
    "climbs",
  ]) {
    if (!tableExists(database, table)) {
      throw new Error(`This is not an Ultra planning database. Missing table: ${table}`);
    }
  }

  const version = Number(readMetadataValue(database, "transport_version"));
  if (version !== PLANNING_TRANSPORT_VERSION) {
    throw new Error(
      `Unsupported planning database version ${version || "unknown"}. Expected ${PLANNING_TRANSPORT_VERSION}.`,
    );
  }
}

function selectAll<T>(
  database: SQLiteDatabase,
  query: string,
  params: SQLiteBindValue[] = [],
): T[] {
  return database.getAllSync<T>(query, params);
}

function normalizeRoute(row: RawRouteRow): Route {
  return {
    ...row,
    isActive: toBoolean(row.isActive),
    isVisible: toBoolean(row.isVisible),
  };
}

function normalizeCollection(row: RawCollectionRow): Collection {
  return {
    ...row,
    isActive: toBoolean(row.isActive),
  };
}

function normalizeCollectionSegment(row: RawCollectionSegmentRow): CollectionSegment {
  return {
    ...row,
    isSelected: toBoolean(row.isSelected),
    variantKind: row.variantKind === "patch" ? "patch" : "full",
  };
}

function normalizePOI(row: RawPOIRow): POI {
  return {
    ...row,
    source: row.source as POISource,
    category: row.category as POI["category"],
    tags: parseTags(row.tags),
  };
}

function normalizeStarredItem(row: RawStarredItemRow): StarredItem | null {
  if (row.entityType !== "poi") return null;
  return { ...row, entityType: "poi" };
}

function readPlannerFetchedSources(database: SQLiteDatabase): PlannerFetchedSourcePair[] {
  const raw = safeJsonParse<PlannerFetchedSourcePair[]>(
    readMetadataValue(database, PLANNER_FETCHED_SOURCES_METADATA_KEY),
    [],
  );
  return raw.filter((pair) => pair.routeId && isFetchedSource(pair.source));
}

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function deleteStarredPoiIds(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  ids: string[],
) {
  for (const idChunk of chunk(ids)) {
    tx.delete(starredItems)
      .where(and(eq(starredItems.entityType, "poi"), inArray(starredItems.entityId, idChunk)))
      .run();
  }
}

export async function createPlanningDatabaseExport(): Promise<PlanningDatabaseExport> {
  const [allRoutes, allCollections] = await Promise.all([getAllRoutes(), getAllCollections()]);
  const routeIds = allRoutes.map((route) => route.id);
  const collectionIds = allCollections.map((collection) => collection.id);

  setPlanningMetadata("transport_version", String(PLANNING_TRANSPORT_VERSION));
  setPlanningMetadata("exported_at", new Date().toISOString());
  setPlanningMetadata("export_scope", "all");
  setPlanningMetadata("exported_route_ids", JSON.stringify(routeIds));
  setPlanningMetadata("exported_collection_ids", JSON.stringify(collectionIds));
  if (readMetadataValue(appSQLiteDb, PLANNER_FETCHED_SOURCES_METADATA_KEY) == null) {
    setPlanningMetadata(PLANNER_FETCHED_SOURCES_METADATA_KEY, "[]");
  }

  appSQLiteDb.execSync("PRAGMA wal_checkpoint(FULL);");
  const bytes = normalizeSQLiteTransportBytes(appSQLiteDb.serializeSync());
  return {
    routeCount: routeIds.length,
    collectionCount: collectionIds.length,
    byteLength: bytes.byteLength,
    fileName: PLANNING_EXPORT_FILE_NAME,
    bytes,
  };
}

export function importPlanningDatabaseFromBytes(bytes: Uint8Array): PlanningImportSummary {
  const source = deserializeDatabaseSync(normalizeSQLiteTransportBytes(bytes));
  try {
    return importPlanningDatabase(source);
  } finally {
    source.closeSync();
  }
}

export function importPlanningDatabase(source: SQLiteDatabase): PlanningImportSummary {
  requirePlanningTransport(source);

  const importedRoutes = selectAll<RawRouteRow>(source, "SELECT * FROM routes").map(normalizeRoute);
  const importedRouteIds = importedRoutes.map((route) => route.id);
  const importedRoutePoints = selectAll<ImportedRoutePoint>(
    source,
    "SELECT * FROM route_points ORDER BY routeId, idx",
  );
  const importedCollections = selectAll<RawCollectionRow>(source, "SELECT * FROM collections").map(
    normalizeCollection,
  );
  const importedCollectionIds = importedCollections.map((collection) => collection.id);
  const importedCollectionSegments = selectAll<RawCollectionSegmentRow>(
    source,
    "SELECT * FROM collection_segments ORDER BY collectionId, position",
  ).map(normalizeCollectionSegment);
  const importedPOIs = selectAll<RawPOIRow>(source, "SELECT * FROM pois").map(normalizePOI);
  const importedStarredItems = selectAll<RawStarredItemRow>(
    source,
    "SELECT * FROM starred_items WHERE entityType = 'poi'",
  )
    .map(normalizeStarredItem)
    .filter((item): item is StarredItem => item != null);
  const importedClimbs = selectAll<RawClimbRow>(
    source,
    "SELECT * FROM climbs ORDER BY routeId, startDistanceMeters",
  );

  const fetchedPairs = readPlannerFetchedSources(source);
  const fetchedPairKeys = new Set(fetchedPairs.map(pairKey));
  const importedPoiIds = new Set(importedPOIs.map((poi) => poi.id));
  const sourceStarredIds = new Set(importedStarredItems.map((item) => item.entityId));
  const localSourcePoiIdsToDelete: string[] = [];

  for (const pair of fetchedPairs) {
    const rows = appSQLiteDb.getAllSync<{ id: string }>(
      "SELECT id FROM pois WHERE routeId = ? AND source = ?",
      [pair.routeId, pair.source],
    );
    localSourcePoiIdsToDelete.push(...rows.map((row) => row.id));
  }

  db.transaction((tx) => {
    for (const route of importedRoutes) {
      tx.insert(routes)
        .values(route)
        .onConflictDoUpdate({
          target: routes.id,
          set: {
            name: route.name,
            fileName: route.fileName,
            color: route.color,
            isActive: route.isActive,
            isVisible: route.isVisible,
            totalDistanceMeters: route.totalDistanceMeters,
            totalAscentMeters: route.totalAscentMeters,
            totalDescentMeters: route.totalDescentMeters,
            pointCount: route.pointCount,
            createdAt: route.createdAt,
          },
        })
        .run();
    }

    if (importedRouteIds.length > 0) {
      tx.delete(routePoints).where(inArray(routePoints.routeId, importedRouteIds)).run();
      for (const pointChunk of chunk(importedRoutePoints)) {
        tx.insert(routePoints).values(pointChunk).run();
      }
    }

    for (const collection of importedCollections) {
      tx.insert(collections)
        .values(collection)
        .onConflictDoUpdate({
          target: collections.id,
          set: {
            name: collection.name,
            isActive: collection.isActive,
            createdAt: collection.createdAt,
            plannedStartMs: collection.plannedStartMs,
          },
        })
        .run();
    }

    if (importedCollectionIds.length > 0) {
      tx.delete(collectionSegments)
        .where(inArray(collectionSegments.collectionId, importedCollectionIds))
        .run();
      for (const segmentChunk of chunk(importedCollectionSegments)) {
        tx.insert(collectionSegments).values(segmentChunk).run();
      }
    }

    if (localSourcePoiIdsToDelete.length > 0) {
      deleteStarredPoiIds(tx, localSourcePoiIdsToDelete);
    }

    for (const pair of fetchedPairs) {
      tx.delete(pois)
        .where(and(eq(pois.routeId, pair.routeId), eq(pois.source, pair.source)))
        .run();
    }

    const poisToUpsert = importedPOIs.filter(
      (poi) =>
        poi.source === "custom" || fetchedPairKeys.has(pairKey(poi as PlannerFetchedSourcePair)),
    );

    for (const poiChunk of chunk(poisToUpsert)) {
      tx.insert(pois)
        .values(poiChunk)
        .onConflictDoUpdate({
          target: pois.id,
          set: {
            sourceId: sql`excluded.sourceId`,
            source: sql`excluded.source`,
            routeId: sql`excluded.routeId`,
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            latitude: sql`excluded.latitude`,
            longitude: sql`excluded.longitude`,
            tags: sql`excluded.tags`,
            distanceFromRouteMeters: sql`excluded.distanceFromRouteMeters`,
            distanceAlongRouteMeters: sql`excluded.distanceAlongRouteMeters`,
          },
        })
        .run();
    }

    const poisToTagUpdate = importedPOIs.filter(
      (poi) =>
        poi.source !== "custom" && !fetchedPairKeys.has(pairKey(poi as PlannerFetchedSourcePair)),
    );
    for (const poi of poisToTagUpdate) {
      tx.update(pois).set({ tags: poi.tags }).where(eq(pois.id, poi.id)).run();
    }

    const importedStarScope = [...importedPoiIds];
    const localStarIdsToRemove = importedStarScope.filter((id) => !sourceStarredIds.has(id));
    deleteStarredPoiIds(tx, localStarIdsToRemove);
    for (const itemChunk of chunk(
      importedStarredItems.filter((item) => importedPoiIds.has(item.entityId)),
    )) {
      tx.insert(starredItems).values(itemChunk).onConflictDoNothing().run();
    }

    for (const climb of importedClimbs) {
      tx.insert(climbs)
        .values(climb)
        .onConflictDoUpdate({
          target: climbs.id,
          set: { name: climb.name },
        })
        .run();
    }
  });

  return {
    routes: importedRoutes.length,
    collections: importedCollections.length,
    pois: importedPOIs.length,
    starredItems: importedStarredItems.length,
    climbs: importedClimbs.length,
    replacedFetchedSources: fetchedPairs.length,
  };
}
