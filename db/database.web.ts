import {
  deleteDatabaseAsync,
  openDatabaseAsync,
  type SQLiteBindValue,
  type SQLiteDatabase,
} from "expo-sqlite";
import migrations from "../drizzle/migrations";
import type {
  Climb,
  Collection,
  CollectionSegment,
  POI,
  POICategory,
  POISource,
  Route,
  RoutePoint,
  RouteWithPoints,
  RelativeETAScope,
  StarredEntityType,
  StarredItem,
} from "@/types";

const CHUNK_SIZE = 500;
const MIGRATIONS_TABLE = "__drizzle_migrations";
const WEB_DATABASE_NAME = "ultra.db";
const WEB_DATABASE_SIDE_FILES = [
  WEB_DATABASE_NAME,
  `${WEB_DATABASE_NAME}-journal`,
  `${WEB_DATABASE_NAME}-wal`,
  `${WEB_DATABASE_NAME}-shm`,
];

type RawBoolean = boolean | number;

type RawRoute = Omit<Route, "isActive" | "isVisible"> & {
  isActive: RawBoolean;
  isVisible: RawBoolean;
};

type RawCollection = Omit<Collection, "isActive"> & {
  isActive: RawBoolean;
};

type RawCollectionSegment = Omit<CollectionSegment, "isSelected" | "variantKind"> & {
  isSelected: RawBoolean;
  variantKind: string;
};

type RawPOI = Omit<POI, "source" | "category" | "tags"> & {
  source: string;
  category: string;
  tags: string | Record<string, string>;
};

type RawStarredItem = Omit<StarredItem, "entityType"> & {
  entityType: string;
};

export interface RelativeETACacheRecord {
  cacheKey: string;
  scope: RelativeETAScope;
  scopeId: string;
  signature: string;
  powerConfigKey: string;
  algorithmVersion: number;
  pointCount: number;
  totalDurationSeconds: number;
  cumulativeSeconds: Uint8Array;
  updatedAt: string;
}

type RawRelativeETACacheRecord = Omit<RelativeETACacheRecord, "scope" | "cumulativeSeconds"> & {
  scope: string;
  cumulativeSeconds: Uint8Array | ArrayBuffer | number[];
};

let databasePromise: Promise<SQLiteDatabase> | null = null;

export const appSQLiteDb = null as unknown as SQLiteDatabase;
export const db = new Proxy(
  {},
  {
    get() {
      throw new Error("The synchronous Drizzle database is not available on web.");
    },
  },
) as never;

function boolToInt(value: boolean): number {
  return value ? 1 : 0;
}

function toBoolean(value: RawBoolean): boolean {
  return value === true || value === 1;
}

function normalizeRoute(row: RawRoute): Route {
  return {
    ...row,
    isActive: toBoolean(row.isActive),
    isVisible: toBoolean(row.isVisible),
  };
}

function normalizeCollection(row: RawCollection): Collection {
  return {
    ...row,
    isActive: toBoolean(row.isActive),
  };
}

function normalizeCollectionSegment(row: RawCollectionSegment): CollectionSegment {
  return {
    ...row,
    isSelected: toBoolean(row.isSelected),
    variantKind: row.variantKind === "patch" ? "patch" : "full",
  };
}

function parseTags(value: RawPOI["tags"]): Record<string, string> {
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

function normalizePOI(row: RawPOI): POI {
  return {
    ...row,
    source: row.source as POISource,
    category: row.category as POICategory,
    tags: parseTags(row.tags),
  };
}

function normalizeStarredItem(row: RawStarredItem): StarredItem {
  return {
    ...row,
    entityType: row.entityType as StarredEntityType,
  };
}

function toUint8Array(value: Uint8Array | ArrayBuffer | number[]): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return new Uint8Array(value);
}

function normalizeRelativeETACacheRecord(row: RawRelativeETACacheRecord): RelativeETACacheRecord {
  return {
    ...row,
    scope: row.scope === "collection" ? "collection" : "route",
    cumulativeSeconds: toUint8Array(row.cumulativeSeconds),
  };
}

async function ensureRelativeETACacheSchema(): Promise<void> {
  await (
    await getWebSQLiteDatabase()
  ).execAsync(`
    CREATE TABLE IF NOT EXISTS relative_eta_cache (
      cacheKey text PRIMARY KEY NOT NULL,
      scope text NOT NULL,
      scopeId text NOT NULL,
      signature text NOT NULL,
      powerConfigKey text NOT NULL,
      algorithmVersion integer NOT NULL,
      pointCount integer NOT NULL,
      totalDurationSeconds real NOT NULL,
      cumulativeSeconds blob NOT NULL,
      updatedAt text NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_relative_eta_cache_scope
      ON relative_eta_cache (scope, scopeId);
  `);
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => "?").join(",");
}

function chunk<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    chunks.push(items.slice(i, i + CHUNK_SIZE));
  }
  return chunks;
}

function migrationStatements(sql: string): string[] {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function runMigrations(database: SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);

  const lastMigration = await database.getFirstAsync<{ created_at: number | string }>(
    `SELECT created_at FROM ${MIGRATIONS_TABLE} ORDER BY created_at DESC LIMIT 1`,
  );
  const lastCreatedAt = Number(lastMigration?.created_at ?? 0);

  await database.withTransactionAsync(async () => {
    for (const entry of migrations.journal.entries) {
      if (lastCreatedAt >= entry.when) continue;

      const migrationKey =
        `m${entry.idx.toString().padStart(4, "0")}` as keyof typeof migrations.migrations;
      const migrationSql = migrations.migrations[migrationKey];
      if (!migrationSql) {
        throw new Error(`Missing migration: ${entry.tag}`);
      }

      for (const statement of migrationStatements(migrationSql)) {
        await database.execAsync(statement);
      }
      await database.runAsync(
        `INSERT INTO ${MIGRATIONS_TABLE} (hash, created_at) VALUES (?, ?)`,
        "",
        entry.when,
      );
    }
  });
}

export async function getWebSQLiteDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const database = await openDatabaseAsync(WEB_DATABASE_NAME);
      // Expo SQLite web stores persistent files in a small OPFS access-handle
      // pool. Avoid WAL sidecar files here; the web DB is a disposable planner
      // workspace, not the native source of truth.
      await database.execAsync("PRAGMA journal_mode = MEMORY;");
      await database.execAsync("PRAGMA foreign_keys = ON;");
      await runMigrations(database);
      return database;
    })().catch((error) => {
      databasePromise = null;
      throw error;
    });
  }

  return databasePromise;
}

export async function resetWebSQLiteDatabaseStorage(): Promise<void> {
  const currentDatabasePromise = databasePromise;
  databasePromise = null;

  if (currentDatabasePromise) {
    try {
      const database = await currentDatabasePromise;
      await database.closeAsync();
    } catch (error) {
      console.warn("[planning-transport] Failed to close web SQLite database before reset", error);
    }
  }

  for (const databaseName of WEB_DATABASE_SIDE_FILES) {
    try {
      await deleteDatabaseAsync(databaseName);
    } catch (error) {
      console.warn("[planning-transport] Failed to delete web SQLite file", databaseName, error);
    }
  }
}

async function getAll<T>(query: string, params: SQLiteBindValue[] = []): Promise<T[]> {
  return (await getWebSQLiteDatabase()).getAllAsync<T>(query, params);
}

async function getFirst<T>(query: string, params: SQLiteBindValue[] = []): Promise<T | null> {
  return (await getWebSQLiteDatabase()).getFirstAsync<T>(query, params);
}

async function run(query: string, params: SQLiteBindValue[] = []): Promise<void> {
  await (await getWebSQLiteDatabase()).runAsync(query, params);
}

async function deleteStarredPoiIds(database: SQLiteDatabase, ids: string[]): Promise<void> {
  for (const idChunk of chunk(ids)) {
    await database.runAsync(
      `DELETE FROM starred_items WHERE entityType = 'poi' AND entityId IN (${placeholders(idChunk.length)})`,
      idChunk,
    );
  }
}

// --- Planning metadata ---

export async function setPlanningMetadata(key: string, value: string): Promise<void> {
  await run(
    `INSERT INTO planning_metadata (key, value, updatedAt)
     VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    [key, value, new Date().toISOString()],
  );
}

export async function getPlanningMetadata(key: string): Promise<string | null> {
  return (
    (await getFirst<{ value: string }>("SELECT value FROM planning_metadata WHERE key = ?", [key]))
      ?.value ?? null
  );
}

// --- Derived Data CRUD ---

export async function getRelativeETACache(
  cacheKey: string,
): Promise<RelativeETACacheRecord | null> {
  await ensureRelativeETACacheSchema();
  const row = await getFirst<RawRelativeETACacheRecord>(
    `SELECT cacheKey, scope, scopeId, signature, powerConfigKey, algorithmVersion,
            pointCount, totalDurationSeconds, cumulativeSeconds, updatedAt
     FROM relative_eta_cache
     WHERE cacheKey = ?`,
    [cacheKey],
  );
  return row ? normalizeRelativeETACacheRecord(row) : null;
}

export async function upsertRelativeETACache(record: RelativeETACacheRecord): Promise<void> {
  await ensureRelativeETACacheSchema();
  await run(
    `INSERT INTO relative_eta_cache (
       cacheKey, scope, scopeId, signature, powerConfigKey, algorithmVersion,
       pointCount, totalDurationSeconds, cumulativeSeconds, updatedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(cacheKey) DO UPDATE SET
       scope = excluded.scope,
       scopeId = excluded.scopeId,
       signature = excluded.signature,
       powerConfigKey = excluded.powerConfigKey,
       algorithmVersion = excluded.algorithmVersion,
       pointCount = excluded.pointCount,
       totalDurationSeconds = excluded.totalDurationSeconds,
       cumulativeSeconds = excluded.cumulativeSeconds,
       updatedAt = excluded.updatedAt`,
    [
      record.cacheKey,
      record.scope,
      record.scopeId,
      record.signature,
      record.powerConfigKey,
      record.algorithmVersion,
      record.pointCount,
      record.totalDurationSeconds,
      record.cumulativeSeconds,
      record.updatedAt,
    ],
  );
}

export async function deleteRelativeETACache(
  scope: RelativeETAScope,
  scopeId: string,
): Promise<void> {
  await ensureRelativeETACacheSchema();
  await run("DELETE FROM relative_eta_cache WHERE scope = ? AND scopeId = ?", [scope, scopeId]);
}

export async function clearRelativeETACaches(scopeId?: string): Promise<void> {
  await ensureRelativeETACacheSchema();
  if (scopeId) {
    await run("DELETE FROM relative_eta_cache WHERE scopeId = ?", [scopeId]);
    return;
  }
  await run("DELETE FROM relative_eta_cache");
}

// --- Route CRUD ---

export async function insertRoute(route: Route, points: RoutePoint[]): Promise<void> {
  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO routes (
        id, name, fileName, color, isActive, isVisible, totalDistanceMeters,
        totalAscentMeters, totalDescentMeters, pointCount, createdAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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

    for (const point of points) {
      await database.runAsync(
        `INSERT INTO route_points (
          routeId, idx, latitude, longitude, elevationMeters, distanceFromStartMeters
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          route.id,
          point.idx,
          point.latitude,
          point.longitude,
          point.elevationMeters,
          point.distanceFromStartMeters,
        ],
      );
    }
  });
}

export async function getAllRoutes(): Promise<Route[]> {
  return (await getAll<RawRoute>("SELECT * FROM routes ORDER BY createdAt DESC")).map(
    normalizeRoute,
  );
}

export async function getRoute(routeId: string): Promise<Route | null> {
  const row = await getFirst<RawRoute>("SELECT * FROM routes WHERE id = ?", [routeId]);
  return row ? normalizeRoute(row) : null;
}

export async function getRouteWithPoints(routeId: string): Promise<RouteWithPoints | null> {
  const route = await getRoute(routeId);
  if (!route) return null;
  const points = await getRoutePoints(routeId);
  return { ...route, points };
}

export async function getRouteEndpoints(
  routeId: string,
): Promise<{ first: RoutePoint; last: RoutePoint } | null> {
  const first = await getFirst<RoutePoint>(
    `SELECT latitude, longitude, elevationMeters, distanceFromStartMeters, idx
     FROM route_points WHERE routeId = ? ORDER BY idx ASC LIMIT 1`,
    [routeId],
  );
  const last = await getFirst<RoutePoint>(
    `SELECT latitude, longitude, elevationMeters, distanceFromStartMeters, idx
     FROM route_points WHERE routeId = ? ORDER BY idx DESC LIMIT 1`,
    [routeId],
  );
  return first && last ? { first, last } : null;
}

export async function getRoutePoints(routeId: string): Promise<RoutePoint[]> {
  return getAll<RoutePoint>("SELECT * FROM route_points WHERE routeId = ? ORDER BY idx ASC", [
    routeId,
  ]);
}

export async function deleteRoute(routeId: string): Promise<void> {
  const database = await getWebSQLiteDatabase();
  const poiIds = await database.getAllAsync<{ id: string }>(
    "SELECT id FROM pois WHERE routeId = ?",
    [routeId],
  );

  await database.withTransactionAsync(async () => {
    await deleteStarredPoiIds(
      database,
      poiIds.map((row) => row.id),
    );
    await database.runAsync("DELETE FROM routes WHERE id = ?", [routeId]);
  });
  await deleteRelativeETACache("route", routeId);
}

export async function updateRouteVisibility(routeId: string, isVisible: boolean): Promise<void> {
  await run("UPDATE routes SET isVisible = ? WHERE id = ?", [boolToInt(isVisible), routeId]);
}

export async function setRoutesVisible(routeIds: string[]): Promise<void> {
  if (routeIds.length === 0) return;
  await run(
    `UPDATE routes SET isVisible = 1 WHERE id IN (${placeholders(routeIds.length)})`,
    routeIds,
  );
}

export async function setActiveRoute(routeId: string): Promise<void> {
  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync("UPDATE collections SET isActive = 0");
    await database.runAsync("UPDATE routes SET isActive = 0");
    await database.runAsync("UPDATE routes SET isActive = 1, isVisible = 1 WHERE id = ?", [
      routeId,
    ]);
  });
}

export async function updateRouteElevationData(
  routeId: string,
  points: RoutePoint[],
  totals: { totalAscentMeters: number; totalDescentMeters: number },
): Promise<void> {
  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE routes SET totalAscentMeters = ?, totalDescentMeters = ? WHERE id = ?",
      [totals.totalAscentMeters, totals.totalDescentMeters, routeId],
    );
    for (const point of points) {
      await database.runAsync(
        "UPDATE route_points SET elevationMeters = ? WHERE routeId = ? AND idx = ?",
        [point.elevationMeters, routeId, point.idx],
      );
    }
  });
}

// --- POI CRUD ---

export async function insertPOIs(newPois: POI[]): Promise<void> {
  if (newPois.length === 0) return;

  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    for (const poi of newPois) {
      await database.runAsync(
        `INSERT INTO pois (
          id, sourceId, source, routeId, name, category, latitude, longitude, tags,
          distanceFromRouteMeters, distanceAlongRouteMeters
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          category = excluded.category,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          tags = excluded.tags,
          distanceFromRouteMeters = excluded.distanceFromRouteMeters,
          distanceAlongRouteMeters = excluded.distanceAlongRouteMeters`,
        [
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
    }
  });
}

export async function getPOIsForRoute(
  routeId: string,
  categories?: POICategory[],
  maxDistFromRoute?: number,
): Promise<POI[]> {
  const conditions = ["routeId = ?"];
  const params: SQLiteBindValue[] = [routeId];

  if (categories && categories.length > 0) {
    conditions.push(`category IN (${placeholders(categories.length)})`);
    params.push(...categories);
  }
  if (maxDistFromRoute != null) {
    conditions.push("distanceFromRouteMeters <= ?");
    params.push(maxDistFromRoute);
  }

  return (
    await getAll<RawPOI>(
      `SELECT * FROM pois WHERE ${conditions.join(" AND ")} ORDER BY distanceAlongRouteMeters ASC`,
      params,
    )
  ).map(normalizePOI);
}

export async function deletePOIsForRoute(routeId: string): Promise<void> {
  const database = await getWebSQLiteDatabase();
  const poiIds = await database.getAllAsync<{ id: string }>(
    "SELECT id FROM pois WHERE routeId = ?",
    [routeId],
  );

  await database.withTransactionAsync(async () => {
    await deleteStarredPoiIds(
      database,
      poiIds.map((row) => row.id),
    );
    await database.runAsync("DELETE FROM pois WHERE routeId = ?", [routeId]);
  });
}

interface DeletePOIsBySourceOptions {
  deleteStarredItems?: boolean;
}

export async function deletePOIsBySource(
  routeId: string,
  source: POISource,
  options: DeletePOIsBySourceOptions = {},
): Promise<void> {
  const database = await getWebSQLiteDatabase();
  const poiIds = options.deleteStarredItems
    ? await database.getAllAsync<{ id: string }>(
        "SELECT id FROM pois WHERE routeId = ? AND source = ?",
        [routeId, source],
      )
    : [];

  await database.withTransactionAsync(async () => {
    if (options.deleteStarredItems) {
      await deleteStarredPoiIds(
        database,
        poiIds.map((row) => row.id),
      );
    }
    await database.runAsync("DELETE FROM pois WHERE routeId = ? AND source = ?", [routeId, source]);
  });
}

export async function updatePOITags(poiId: string, tags: Record<string, string>): Promise<void> {
  await run("UPDATE pois SET tags = ? WHERE id = ?", [JSON.stringify(tags), poiId]);
}

export async function deletePOI(poiId: string): Promise<void> {
  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync("DELETE FROM starred_items WHERE entityType = 'poi' AND entityId = ?", [
      poiId,
    ]);
    await database.runAsync("DELETE FROM pois WHERE id = ?", [poiId]);
  });
}

export async function hasPOIsForRoute(routeId: string): Promise<boolean> {
  const row = await getFirst<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM pois WHERE routeId = ?",
    [routeId],
  );
  return (row?.cnt ?? 0) > 0;
}

export async function getPOICountsBySource(
  routeId: string,
): Promise<{ osm: number; google: number }> {
  const rows = await getAll<{ source: POISource; cnt: number }>(
    "SELECT source, COUNT(*) AS cnt FROM pois WHERE routeId = ? GROUP BY source",
    [routeId],
  );

  let osm = 0;
  let google = 0;
  for (const row of rows) {
    if (row.source === "google") google = row.cnt;
    else if (row.source === "osm") osm += row.cnt;
  }
  return { osm, google };
}

// --- Starred Item CRUD ---

export async function getStarredItems(entityType?: StarredEntityType): Promise<StarredItem[]> {
  const rows = entityType
    ? await getAll<RawStarredItem>(
        "SELECT * FROM starred_items WHERE entityType = ? ORDER BY createdAt ASC",
        [entityType],
      )
    : await getAll<RawStarredItem>("SELECT * FROM starred_items ORDER BY createdAt ASC");

  return rows.map(normalizeStarredItem);
}

export async function setStarredItem(
  entityType: StarredEntityType,
  entityId: string,
  starred: boolean,
): Promise<void> {
  if (starred) {
    await run(
      `INSERT INTO starred_items (entityType, entityId, createdAt)
       VALUES (?, ?, ?)
       ON CONFLICT(entityType, entityId) DO NOTHING`,
      [entityType, entityId, new Date().toISOString()],
    );
    return;
  }

  await run("DELETE FROM starred_items WHERE entityType = ? AND entityId = ?", [
    entityType,
    entityId,
  ]);
}

// --- Climb CRUD ---

export async function insertClimbs(newClimbs: Climb[]): Promise<void> {
  if (newClimbs.length === 0) return;

  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    for (const climb of newClimbs) {
      await database.runAsync(
        `INSERT INTO climbs (
          id, routeId, name, startDistanceMeters, endDistanceMeters, lengthMeters,
          totalAscentMeters, startElevationMeters, endElevationMeters,
          averageGradientPercent, maxGradientPercent, difficultyScore
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
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
    }
  });
}

export async function getClimbsForRoute(routeId: string): Promise<Climb[]> {
  return getAll<Climb>("SELECT * FROM climbs WHERE routeId = ? ORDER BY startDistanceMeters ASC", [
    routeId,
  ]);
}

export async function deleteClimbsForRoute(routeId: string): Promise<void> {
  await run("DELETE FROM climbs WHERE routeId = ?", [routeId]);
}

export async function updateClimbName(climbId: string, name: string | null): Promise<void> {
  await run("UPDATE climbs SET name = ? WHERE id = ?", [name, climbId]);
}

// --- Collection CRUD ---

export async function insertCollection(collection: Collection): Promise<void> {
  await run(
    `INSERT INTO collections (id, name, isActive, createdAt, plannedStartMs)
     VALUES (?, ?, ?, ?, ?)`,
    [
      collection.id,
      collection.name,
      boolToInt(collection.isActive),
      collection.createdAt,
      collection.plannedStartMs,
    ],
  );
}

export async function getAllCollections(): Promise<Collection[]> {
  return (await getAll<RawCollection>("SELECT * FROM collections ORDER BY createdAt DESC")).map(
    normalizeCollection,
  );
}

export async function deleteCollection(collectionId: string): Promise<void> {
  await run("DELETE FROM collections WHERE id = ?", [collectionId]);
  await deleteRelativeETACache("collection", collectionId);
}

export async function renameCollection(collectionId: string, name: string): Promise<void> {
  await run("UPDATE collections SET name = ? WHERE id = ?", [name, collectionId]);
}

export async function updateCollectionPlannedStart(
  collectionId: string,
  plannedStartMs: number | null,
): Promise<void> {
  await run("UPDATE collections SET plannedStartMs = ? WHERE id = ?", [
    plannedStartMs,
    collectionId,
  ]);
}

export async function setActiveCollection(collectionId: string): Promise<void> {
  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    await database.runAsync("UPDATE routes SET isActive = 0");
    await database.runAsync("UPDATE collections SET isActive = 0");
    await database.runAsync("UPDATE collections SET isActive = 1 WHERE id = ?", [collectionId]);
  });
}

export async function clearActiveCollection(): Promise<void> {
  await run("UPDATE collections SET isActive = 0");
}

// --- Collection Segment CRUD ---

export async function insertCollectionSegment(segment: CollectionSegment): Promise<void> {
  await run(
    `INSERT INTO collection_segments (
      collectionId, routeId, position, isSelected, variantKind, baseRouteId,
      replaceStartDistanceMeters, replaceEndDistanceMeters
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
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
}

export async function deleteCollectionSegment(
  collectionId: string,
  routeId: string,
): Promise<void> {
  await run("DELETE FROM collection_segments WHERE collectionId = ? AND routeId = ?", [
    collectionId,
    routeId,
  ]);
}

export async function deletePatchVariantsForBaseRoute(
  collectionId: string,
  baseRouteId: string,
): Promise<void> {
  await run("DELETE FROM collection_segments WHERE collectionId = ? AND baseRouteId = ?", [
    collectionId,
    baseRouteId,
  ]);
}

export async function getCollectionSegments(collectionId: string): Promise<CollectionSegment[]> {
  return (
    await getAll<RawCollectionSegment>(
      `SELECT * FROM collection_segments
       WHERE collectionId = ?
       ORDER BY position ASC, isSelected DESC`,
      [collectionId],
    )
  ).map(normalizeCollectionSegment);
}

export async function selectVariant(collectionId: string, routeId: string): Promise<void> {
  const database = await getWebSQLiteDatabase();
  const row = await database.getFirstAsync<{ position: number }>(
    "SELECT position FROM collection_segments WHERE collectionId = ? AND routeId = ?",
    [collectionId, routeId],
  );
  if (!row) return;

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      "UPDATE collection_segments SET isSelected = 0 WHERE collectionId = ? AND position = ?",
      [collectionId, row.position],
    );
    await database.runAsync(
      "UPDATE collection_segments SET isSelected = 1 WHERE collectionId = ? AND routeId = ?",
      [collectionId, routeId],
    );
  });
}

export async function updateSegmentPositions(
  collectionId: string,
  positions: { routeId: string; position: number }[],
): Promise<void> {
  const database = await getWebSQLiteDatabase();
  await database.withTransactionAsync(async () => {
    for (const { routeId, position } of positions) {
      await database.runAsync(
        "UPDATE collection_segments SET position = ? WHERE collectionId = ? AND routeId = ?",
        [position, collectionId, routeId],
      );
    }
  });
}

export async function getAllAssignedRouteIds(): Promise<Set<string>> {
  const rows = await getAll<{ routeId: string }>(
    "SELECT DISTINCT routeId FROM collection_segments",
  );
  return new Set(rows.map((row) => row.routeId));
}

export async function getMaxSegmentPosition(collectionId: string): Promise<number> {
  const row = await getFirst<{ maxPos: number | null }>(
    "SELECT MAX(position) AS maxPos FROM collection_segments WHERE collectionId = ?",
    [collectionId],
  );
  return row?.maxPos ?? -1;
}
