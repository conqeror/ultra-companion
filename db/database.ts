import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { sql, eq, and, inArray, desc, asc, count, max } from "drizzle-orm";
import {
  routes,
  routePoints,
  ferryCrossings,
  pois,
  starredItems,
  collections,
  collectionSegments,
  climbs,
  planningMetadata,
  relativeEtaCache,
} from "./schema";
import migrations from "../drizzle/migrations";
import {
  hasSupportedFerryCrossingsSchema,
  shouldPrepareFerryCrossingsSchema,
} from "./ferrySchemaCompatibility";
import { measureAsync } from "@/utils/perfMarks";
import type {
  Route,
  RoutePoint,
  RouteWithPoints,
  FerryCrossing,
  POI,
  POICategory,
  POISource,
  StarredEntityType,
  StarredItem,
  Collection,
  CollectionSegment,
  CollectionSegmentVariantKind,
  Climb,
  RelativeETAScope,
} from "@/types";

// --- Database init ---

export const appSQLiteDb = openDatabaseSync("ultra.db");
appSQLiteDb.execSync("PRAGMA journal_mode = WAL;");
appSQLiteDb.execSync("PRAGMA foreign_keys = ON;");

function migrationStatements(migrationSql: string): string[] {
  return migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function prepareFerryCrossingsSchema(): void {
  const migrationsTable = appSQLiteDb.getFirstSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'",
  );
  const latestMigration = migrationsTable
    ? appSQLiteDb.getFirstSync<{ created_at: number | string }>(
        "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
      )
    : null;
  if (!shouldPrepareFerryCrossingsSchema(Number(latestMigration?.created_at ?? 0))) return;

  const ferryTable = appSQLiteDb.getFirstSync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'ferry_crossings'",
  );

  if (ferryTable) {
    const columns = appSQLiteDb.getAllSync<{ name: string }>(
      "PRAGMA table_info(`ferry_crossings`)",
    );
    const foreignKeys = appSQLiteDb.getAllSync<{
      table: string;
      from: string;
      to: string;
      on_delete: string;
    }>("PRAGMA foreign_key_list(`ferry_crossings`)");
    if (!hasSupportedFerryCrossingsSchema(columns, foreignKeys)) {
      // This exact table name was used by unreleased experiments. Its rows cannot be read safely
      // by the supported model, so remove only this table and recreate the canonical schema.
      appSQLiteDb.execSync("DROP TABLE IF EXISTS `ferry_crossings`;");
      console.warn("[database] Removed incompatible experimental ferry_crossings table");
    }
  }

  // Ensure recovery also works if migration 0007 was previously recorded or interrupted. The
  // idempotent statements let the normal migrator record pending migrations without data loss.
  for (const statement of migrationStatements(migrations.migrations.m0007)) {
    appSQLiteDb.execSync(statement);
  }
}

appSQLiteDb.withTransactionSync(prepareFerryCrossingsSchema);

function runBundledMigrationsSync(): void {
  appSQLiteDb.execSync(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    );
  `);

  const latestMigration = appSQLiteDb.getFirstSync<{ created_at: number | string }>(
    "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1",
  );
  const latestCreatedAt = Number(latestMigration?.created_at ?? 0);

  appSQLiteDb.withTransactionSync(() => {
    for (const entry of migrations.journal.entries) {
      if (latestCreatedAt >= entry.when) continue;
      const migrationKey =
        `m${entry.idx.toString().padStart(4, "0")}` as keyof typeof migrations.migrations;
      const migrationSql = migrations.migrations[migrationKey];
      if (!migrationSql) throw new Error(`Missing migration: ${entry.tag}`);

      for (const statement of migrationStatements(migrationSql)) {
        appSQLiteDb.execSync(statement);
      }
      appSQLiteDb.runSync(
        "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)",
        "",
        entry.when,
      );
    }
  });
}

runBundledMigrationsSync();

export const db = drizzle(appSQLiteDb, {
  schema: {
    routes,
    routePoints,
    ferryCrossings,
    pois,
    starredItems,
    collections,
    collectionSegments,
    climbs,
    planningMetadata,
    relativeEtaCache,
  },
});

// --- Planning metadata ---

export function setPlanningMetadata(key: string, value: string): void {
  const updatedAt = new Date().toISOString();
  db.insert(planningMetadata)
    .values({ key, value, updatedAt })
    .onConflictDoUpdate({
      target: planningMetadata.key,
      set: { value, updatedAt },
    })
    .run();
}

export function getPlanningMetadata(key: string): string | null {
  return (
    db
      .select({ value: planningMetadata.value })
      .from(planningMetadata)
      .where(eq(planningMetadata.key, key))
      .get()?.value ?? null
  );
}

function normalizeCollectionSegment(
  row: typeof collectionSegments.$inferSelect,
): CollectionSegment {
  return {
    ...row,
    variantKind: row.variantKind as CollectionSegmentVariantKind,
  };
}

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

function ensureRelativeETACacheSchema(): void {
  appSQLiteDb.execSync(`
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

// --- Derived Data CRUD ---

export async function getRelativeETACache(
  cacheKey: string,
): Promise<RelativeETACacheRecord | null> {
  ensureRelativeETACacheSchema();
  const row = appSQLiteDb.getFirstSync<RawRelativeETACacheRecord>(
    `SELECT cacheKey, scope, scopeId, signature, powerConfigKey, algorithmVersion,
            pointCount, totalDurationSeconds, cumulativeSeconds, updatedAt
     FROM relative_eta_cache
     WHERE cacheKey = ?`,
    [cacheKey],
  );
  return row ? normalizeRelativeETACacheRecord(row) : null;
}

export async function upsertRelativeETACache(record: RelativeETACacheRecord): Promise<void> {
  ensureRelativeETACacheSchema();
  appSQLiteDb.runSync(
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
  ensureRelativeETACacheSchema();
  appSQLiteDb.runSync("DELETE FROM relative_eta_cache WHERE scope = ? AND scopeId = ?", [
    scope,
    scopeId,
  ]);
}

export async function clearRelativeETACaches(scopeId?: string): Promise<void> {
  ensureRelativeETACacheSchema();
  if (scopeId) {
    appSQLiteDb.runSync("DELETE FROM relative_eta_cache WHERE scopeId = ?", [scopeId]);
    return;
  }
  appSQLiteDb.runSync("DELETE FROM relative_eta_cache");
}

// --- Route CRUD ---

export async function insertRoute(
  route: Route,
  points: RoutePoint[],
  routeClimbs: Climb[] = [],
): Promise<void> {
  db.transaction((tx) => {
    tx.insert(routes)
      .values({
        id: route.id,
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
      })
      .run();

    const CHUNK = 500;
    for (let i = 0; i < points.length; i += CHUNK) {
      const chunk = points.slice(i, i + CHUNK);
      tx.insert(routePoints)
        .values(
          chunk.map((p) => ({
            routeId: route.id,
            idx: p.idx,
            latitude: p.latitude,
            longitude: p.longitude,
            elevationMeters: p.elevationMeters,
            distanceFromStartMeters: p.distanceFromStartMeters,
          })),
        )
        .run();
    }

    for (let i = 0; i < routeClimbs.length; i += CHUNK) {
      const chunk = routeClimbs.slice(i, i + CHUNK);
      tx.insert(climbs)
        .values(
          chunk.map((climb) => ({
            id: climb.id,
            routeId: climb.routeId,
            name: climb.name,
            startDistanceMeters: climb.startDistanceMeters,
            endDistanceMeters: climb.endDistanceMeters,
            lengthMeters: climb.lengthMeters,
            totalAscentMeters: climb.totalAscentMeters,
            startElevationMeters: climb.startElevationMeters,
            endElevationMeters: climb.endElevationMeters,
            averageGradientPercent: climb.averageGradientPercent,
            maxGradientPercent: climb.maxGradientPercent,
            difficultyScore: climb.difficultyScore,
          })),
        )
        .run();
    }
  });
}

export async function getAllRoutes(): Promise<Route[]> {
  return db.select().from(routes).orderBy(desc(routes.createdAt)).all();
}

export async function getRoute(routeId: string): Promise<Route | null> {
  const row = db.select().from(routes).where(eq(routes.id, routeId)).get();
  return row ?? null;
}

export async function getRouteWithPoints(routeId: string): Promise<RouteWithPoints | null> {
  const row = db.select().from(routes).where(eq(routes.id, routeId)).get();
  if (!row) return null;

  return {
    ...row,
    points: await getRoutePoints(routeId),
  };
}

export async function getRouteEndpoints(
  routeId: string,
): Promise<{ first: RoutePoint; last: RoutePoint } | null> {
  const first = db
    .select({
      latitude: routePoints.latitude,
      longitude: routePoints.longitude,
      elevationMeters: routePoints.elevationMeters,
      distanceFromStartMeters: routePoints.distanceFromStartMeters,
      idx: routePoints.idx,
    })
    .from(routePoints)
    .where(eq(routePoints.routeId, routeId))
    .orderBy(asc(routePoints.idx))
    .limit(1)
    .get();

  const last = db
    .select({
      latitude: routePoints.latitude,
      longitude: routePoints.longitude,
      elevationMeters: routePoints.elevationMeters,
      distanceFromStartMeters: routePoints.distanceFromStartMeters,
      idx: routePoints.idx,
    })
    .from(routePoints)
    .where(eq(routePoints.routeId, routeId))
    .orderBy(desc(routePoints.idx))
    .limit(1)
    .get();

  if (!first || !last) return null;
  return { first, last };
}

export async function getRoutePoints(routeId: string): Promise<RoutePoint[]> {
  // Drizzle's Expo adapter uses prepareSync/executeSync internally. Route point
  // arrays can contain hundreds of thousands of rows, so use Expo SQLite's
  // native async query path rather than blocking the JS thread while SQLite
  // prepares and steps through the result set.
  return measureAsync("db.routePoints.read", () =>
    appSQLiteDb.getAllAsync<RoutePoint>(
      `SELECT idx, latitude, longitude, elevationMeters, distanceFromStartMeters
       FROM route_points
       WHERE routeId = ?
       ORDER BY idx ASC`,
      [routeId],
    ),
  );
}

// --- Ferry Crossing CRUD ---

function invalidateFerryRelativeETACaches(routeId: string): void {
  appSQLiteDb.runSync(
    `DELETE FROM relative_eta_cache
     WHERE (scope = 'route' AND scopeId = ?)
        OR (scope = 'collection' AND scopeId IN (
          SELECT DISTINCT collectionId
          FROM collection_segments
          WHERE routeId = ? OR baseRouteId = ?
        ))`,
    [routeId, routeId, routeId],
  );
}

export async function upsertFerryCrossing(crossing: FerryCrossing): Promise<void> {
  db.insert(ferryCrossings)
    .values(crossing)
    .onConflictDoUpdate({
      target: ferryCrossings.id,
      set: {
        routeId: crossing.routeId,
        name: crossing.name,
        startDistanceMeters: crossing.startDistanceMeters,
        endDistanceMeters: crossing.endDistanceMeters,
        startLatitude: crossing.startLatitude,
        startLongitude: crossing.startLongitude,
        endLatitude: crossing.endLatitude,
        endLongitude: crossing.endLongitude,
        durationMinutes: crossing.durationMinutes,
        assumedWaitMinutes: crossing.assumedWaitMinutes,
        boardingBufferMinutes: crossing.boardingBufferMinutes,
        source: crossing.source,
        sourceId: crossing.sourceId,
        sourceUrl: crossing.sourceUrl,
        operator: crossing.operator,
        timetableUrl: crossing.timetableUrl,
        bicycleAccess: crossing.bicycleAccess,
        providerRefs: crossing.providerRefs,
        tags: crossing.tags,
        updatedAt: crossing.updatedAt,
      },
    })
    .run();
  invalidateFerryRelativeETACaches(crossing.routeId);
}

export async function getFerryCrossingsForRoute(routeId: string): Promise<FerryCrossing[]> {
  return db
    .select()
    .from(ferryCrossings)
    .where(eq(ferryCrossings.routeId, routeId))
    .orderBy(asc(ferryCrossings.startDistanceMeters))
    .all();
}

export async function getFerryCrossingsForRoutes(routeIds: string[]): Promise<FerryCrossing[]> {
  if (routeIds.length === 0) return [];
  return db
    .select()
    .from(ferryCrossings)
    .where(inArray(ferryCrossings.routeId, routeIds))
    .orderBy(asc(ferryCrossings.routeId), asc(ferryCrossings.startDistanceMeters))
    .all();
}

export async function deleteFerryCrossing(crossingId: string): Promise<void> {
  const crossing = db
    .select({ routeId: ferryCrossings.routeId })
    .from(ferryCrossings)
    .where(eq(ferryCrossings.id, crossingId))
    .get();
  db.delete(ferryCrossings).where(eq(ferryCrossings.id, crossingId)).run();
  if (crossing) invalidateFerryRelativeETACaches(crossing.routeId);
}

export async function deleteRoute(routeId: string): Promise<void> {
  // Foreign keys with ON DELETE CASCADE handle route_points, pois, climbs, and collection_segments.
  // Starred items are generic, so explicitly remove stars for this route's POIs first.
  const poiIds = db.select({ id: pois.id }).from(pois).where(eq(pois.routeId, routeId)).all();
  db.transaction((tx) => {
    if (poiIds.length > 0) {
      tx.delete(starredItems)
        .where(
          and(
            eq(starredItems.entityType, "poi"),
            inArray(
              starredItems.entityId,
              poiIds.map((row) => row.id),
            ),
          ),
        )
        .run();
    }
    tx.delete(routes).where(eq(routes.id, routeId)).run();
  });
  await deleteRelativeETACache("route", routeId);
}

export async function updateRouteVisibility(routeId: string, isVisible: boolean): Promise<void> {
  db.update(routes).set({ isVisible }).where(eq(routes.id, routeId)).run();
}

export async function setRoutesVisible(routeIds: string[]): Promise<void> {
  if (routeIds.length === 0) return;
  db.update(routes).set({ isVisible: true }).where(inArray(routes.id, routeIds)).run();
}

export async function setActiveRoute(routeId: string): Promise<void> {
  db.transaction((tx) => {
    tx.update(collections).set({ isActive: false }).run();
    tx.update(routes).set({ isActive: false }).run();
    tx.update(routes).set({ isActive: true, isVisible: true }).where(eq(routes.id, routeId)).run();
  });
}

export async function updateRouteElevationData(
  routeId: string,
  points: RoutePoint[],
  totals: { totalAscentMeters: number; totalDescentMeters: number },
): Promise<void> {
  db.transaction((tx) => {
    tx.update(routes)
      .set({
        totalAscentMeters: totals.totalAscentMeters,
        totalDescentMeters: totals.totalDescentMeters,
      })
      .where(eq(routes.id, routeId))
      .run();

    for (const point of points) {
      tx.update(routePoints)
        .set({ elevationMeters: point.elevationMeters })
        .where(and(eq(routePoints.routeId, routeId), eq(routePoints.idx, point.idx)))
        .run();
    }
  });
}

// --- POI CRUD ---

export async function insertPOIs(newPois: POI[]): Promise<void> {
  if (newPois.length === 0) return;

  db.transaction((tx) => {
    const CHUNK = 500;
    for (let i = 0; i < newPois.length; i += CHUNK) {
      const chunk = newPois.slice(i, i + CHUNK);
      tx.insert(pois)
        .values(
          chunk.map((p) => ({
            id: p.id,
            sourceId: p.sourceId,
            source: p.source,
            routeId: p.routeId,
            name: p.name,
            category: p.category,
            latitude: p.latitude,
            longitude: p.longitude,
            tags: p.tags,
            distanceFromRouteMeters: p.distanceFromRouteMeters,
            distanceAlongRouteMeters: p.distanceAlongRouteMeters,
          })),
        )
        .onConflictDoUpdate({
          target: pois.id,
          set: {
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
  });
}

export async function getPOIsForRoute(
  routeId: string,
  categories?: POICategory[],
  maxDistFromRoute?: number,
): Promise<POI[]> {
  const conditions = [eq(pois.routeId, routeId)];

  if (categories && categories.length > 0) {
    conditions.push(inArray(pois.category, categories));
  }
  if (maxDistFromRoute != null) {
    conditions.push(sql`${pois.distanceFromRouteMeters} <= ${maxDistFromRoute}`);
  }

  return db
    .select()
    .from(pois)
    .where(and(...conditions))
    .orderBy(asc(pois.distanceAlongRouteMeters))
    .all();
}

export async function deletePOIsForRoute(routeId: string): Promise<void> {
  const poiIds = db.select({ id: pois.id }).from(pois).where(eq(pois.routeId, routeId)).all();
  db.transaction((tx) => {
    if (poiIds.length > 0) {
      tx.delete(starredItems)
        .where(
          and(
            eq(starredItems.entityType, "poi"),
            inArray(
              starredItems.entityId,
              poiIds.map((row) => row.id),
            ),
          ),
        )
        .run();
    }
    tx.delete(pois).where(eq(pois.routeId, routeId)).run();
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
  const where = and(eq(pois.routeId, routeId), eq(pois.source, source));
  const poiIds = options.deleteStarredItems
    ? db.select({ id: pois.id }).from(pois).where(where).all()
    : [];
  db.transaction((tx) => {
    if (options.deleteStarredItems && poiIds.length > 0) {
      tx.delete(starredItems)
        .where(
          and(
            eq(starredItems.entityType, "poi"),
            inArray(
              starredItems.entityId,
              poiIds.map((row) => row.id),
            ),
          ),
        )
        .run();
    }
    tx.delete(pois).where(where).run();
  });
}

export async function updatePOITags(poiId: string, tags: Record<string, string>): Promise<void> {
  db.update(pois).set({ tags }).where(eq(pois.id, poiId)).run();
}

export async function deletePOI(poiId: string): Promise<void> {
  db.transaction((tx) => {
    tx.delete(starredItems)
      .where(and(eq(starredItems.entityType, "poi"), eq(starredItems.entityId, poiId)))
      .run();
    tx.delete(pois).where(eq(pois.id, poiId)).run();
  });
}

export async function hasPOIsForRoute(routeId: string): Promise<boolean> {
  const row = db.select({ count: count() }).from(pois).where(eq(pois.routeId, routeId)).get();
  return (row?.count ?? 0) > 0;
}

export async function getPOICountsBySource(
  routeId: string,
): Promise<{ osm: number; google: number }> {
  const rows = db
    .select({ source: pois.source, cnt: count() })
    .from(pois)
    .where(eq(pois.routeId, routeId))
    .groupBy(pois.source)
    .all();

  let osm = 0,
    google = 0;
  for (const row of rows) {
    if (row.source === "google") google = row.cnt;
    else if (row.source === "osm") osm += row.cnt;
  }
  return { osm, google };
}

// --- Starred Item CRUD ---

export async function getStarredItems(entityType?: StarredEntityType): Promise<StarredItem[]> {
  if (entityType) {
    return db
      .select()
      .from(starredItems)
      .where(eq(starredItems.entityType, entityType))
      .orderBy(asc(starredItems.createdAt))
      .all();
  }

  return db.select().from(starredItems).orderBy(asc(starredItems.createdAt)).all();
}

export async function setStarredItem(
  entityType: StarredEntityType,
  entityId: string,
  starred: boolean,
): Promise<void> {
  if (starred) {
    db.insert(starredItems)
      .values({ entityType, entityId, createdAt: new Date().toISOString() })
      .onConflictDoNothing()
      .run();
    return;
  }

  db.delete(starredItems)
    .where(and(eq(starredItems.entityType, entityType), eq(starredItems.entityId, entityId)))
    .run();
}

// --- Climb CRUD ---

export async function insertClimbs(newClimbs: Climb[]): Promise<void> {
  if (newClimbs.length === 0) return;
  db.transaction((tx) => {
    const CHUNK = 500;
    for (let i = 0; i < newClimbs.length; i += CHUNK) {
      const chunk = newClimbs.slice(i, i + CHUNK);
      tx.insert(climbs)
        .values(
          chunk.map((c) => ({
            id: c.id,
            routeId: c.routeId,
            name: c.name,
            startDistanceMeters: c.startDistanceMeters,
            endDistanceMeters: c.endDistanceMeters,
            lengthMeters: c.lengthMeters,
            totalAscentMeters: c.totalAscentMeters,
            startElevationMeters: c.startElevationMeters,
            endElevationMeters: c.endElevationMeters,
            averageGradientPercent: c.averageGradientPercent,
            maxGradientPercent: c.maxGradientPercent,
            difficultyScore: c.difficultyScore,
          })),
        )
        .run();
    }
  });
}

export async function getClimbsForRoute(routeId: string): Promise<Climb[]> {
  return db
    .select()
    .from(climbs)
    .where(eq(climbs.routeId, routeId))
    .orderBy(asc(climbs.startDistanceMeters))
    .all();
}

export async function deleteClimbsForRoute(routeId: string): Promise<void> {
  db.delete(climbs).where(eq(climbs.routeId, routeId)).run();
}

export async function updateClimbName(climbId: string, name: string | null): Promise<void> {
  db.update(climbs).set({ name }).where(eq(climbs.id, climbId)).run();
}

// --- Collection CRUD ---

export async function insertCollection(collection: Collection): Promise<void> {
  db.insert(collections)
    .values({
      id: collection.id,
      name: collection.name,
      isActive: collection.isActive,
      createdAt: collection.createdAt,
      plannedStartMs: collection.plannedStartMs,
    })
    .run();
}

export async function getAllCollections(): Promise<Collection[]> {
  return db.select().from(collections).orderBy(desc(collections.createdAt)).all();
}

export async function deleteCollection(collectionId: string): Promise<void> {
  // Foreign keys with ON DELETE CASCADE handle collection_segments
  db.delete(collections).where(eq(collections.id, collectionId)).run();
  await deleteRelativeETACache("collection", collectionId);
}

export async function renameCollection(collectionId: string, name: string): Promise<void> {
  db.update(collections).set({ name }).where(eq(collections.id, collectionId)).run();
}

export async function updateCollectionPlannedStart(
  collectionId: string,
  plannedStartMs: number | null,
): Promise<void> {
  db.update(collections).set({ plannedStartMs }).where(eq(collections.id, collectionId)).run();
}

export async function setActiveCollection(collectionId: string): Promise<void> {
  db.transaction((tx) => {
    tx.update(routes).set({ isActive: false }).run();
    tx.update(collections).set({ isActive: false }).run();
    tx.update(collections).set({ isActive: true }).where(eq(collections.id, collectionId)).run();
  });
}

export async function clearActiveCollection(): Promise<void> {
  db.update(collections).set({ isActive: false }).run();
}

// --- Collection Segment CRUD ---

export async function insertCollectionSegment(segment: CollectionSegment): Promise<void> {
  db.insert(collectionSegments)
    .values({
      collectionId: segment.collectionId,
      routeId: segment.routeId,
      position: segment.position,
      isSelected: segment.isSelected,
      variantKind: segment.variantKind,
      baseRouteId: segment.baseRouteId,
      replaceStartDistanceMeters: segment.replaceStartDistanceMeters,
      replaceEndDistanceMeters: segment.replaceEndDistanceMeters,
    })
    .run();
}

export async function deleteCollectionSegment(
  collectionId: string,
  routeId: string,
): Promise<void> {
  db.delete(collectionSegments)
    .where(
      and(
        eq(collectionSegments.collectionId, collectionId),
        eq(collectionSegments.routeId, routeId),
      ),
    )
    .run();
}

export async function deletePatchVariantsForBaseRoute(
  collectionId: string,
  baseRouteId: string,
): Promise<void> {
  db.delete(collectionSegments)
    .where(
      and(
        eq(collectionSegments.collectionId, collectionId),
        eq(collectionSegments.baseRouteId, baseRouteId),
      ),
    )
    .run();
}

export async function getCollectionSegments(collectionId: string): Promise<CollectionSegment[]> {
  const rows = db
    .select()
    .from(collectionSegments)
    .where(eq(collectionSegments.collectionId, collectionId))
    .orderBy(asc(collectionSegments.position), desc(collectionSegments.isSelected))
    .all();
  return rows.map(normalizeCollectionSegment);
}

export async function selectVariant(collectionId: string, routeId: string): Promise<void> {
  const row = db
    .select({ position: collectionSegments.position })
    .from(collectionSegments)
    .where(
      and(
        eq(collectionSegments.collectionId, collectionId),
        eq(collectionSegments.routeId, routeId),
      ),
    )
    .get();
  if (!row) return;

  db.transaction((tx) => {
    tx.update(collectionSegments)
      .set({ isSelected: false })
      .where(
        and(
          eq(collectionSegments.collectionId, collectionId),
          eq(collectionSegments.position, row.position),
        ),
      )
      .run();
    tx.update(collectionSegments)
      .set({ isSelected: true })
      .where(
        and(
          eq(collectionSegments.collectionId, collectionId),
          eq(collectionSegments.routeId, routeId),
        ),
      )
      .run();
  });
}

export async function updateSegmentPositions(
  collectionId: string,
  positions: { routeId: string; position: number }[],
): Promise<void> {
  db.transaction((tx) => {
    for (const { routeId, position } of positions) {
      tx.update(collectionSegments)
        .set({ position })
        .where(
          and(
            eq(collectionSegments.collectionId, collectionId),
            eq(collectionSegments.routeId, routeId),
          ),
        )
        .run();
    }
  });
}

export async function getAllAssignedRouteIds(): Promise<Set<string>> {
  const rows = db
    .selectDistinct({ routeId: collectionSegments.routeId })
    .from(collectionSegments)
    .all();
  return new Set(rows.map((r) => r.routeId));
}

export async function getMaxSegmentPosition(collectionId: string): Promise<number> {
  const row = db
    .select({ maxPos: max(collectionSegments.position) })
    .from(collectionSegments)
    .where(eq(collectionSegments.collectionId, collectionId))
    .get();
  return row?.maxPos ?? -1;
}
