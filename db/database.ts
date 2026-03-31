import { drizzle } from "drizzle-orm/expo-sqlite";
import { openDatabaseSync } from "expo-sqlite";
import { sql, eq, and, inArray, desc, asc, count, max } from "drizzle-orm";
import { routes, routePoints, pois, races, raceSegments } from "./schema";
import type { Route, RoutePoint, RouteWithPoints, POI, POICategory, Race, RaceSegment } from "@/types";

// --- Database init ---

const expoDb = openDatabaseSync("ultra.db");
expoDb.execSync("PRAGMA journal_mode = WAL;");
expoDb.execSync("PRAGMA foreign_keys = ON;");

export const db = drizzle(expoDb, { schema: { routes, routePoints, pois, races, raceSegments } });

// Create tables (Drizzle push is Node-only, so we use raw DDL for table creation)
expoDb.execSync(`
  CREATE TABLE IF NOT EXISTS routes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    fileName TEXT NOT NULL,
    color TEXT NOT NULL,
    isActive INTEGER NOT NULL DEFAULT 0,
    isVisible INTEGER NOT NULL DEFAULT 1,
    totalDistanceMeters REAL NOT NULL,
    totalAscentMeters REAL NOT NULL,
    totalDescentMeters REAL NOT NULL,
    pointCount INTEGER NOT NULL,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS route_points (
    routeId TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    idx INTEGER NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    elevationMeters REAL,
    distanceFromStartMeters REAL NOT NULL,
    PRIMARY KEY (routeId, idx)
  );

  CREATE INDEX IF NOT EXISTS idx_route_points_route ON route_points(routeId);

  CREATE TABLE IF NOT EXISTS pois (
    id TEXT PRIMARY KEY,
    sourceId TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'osm',
    routeId TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    name TEXT,
    category TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    tags TEXT NOT NULL,
    distanceFromRouteMeters REAL NOT NULL,
    distanceAlongRouteMeters REAL NOT NULL,
    UNIQUE(routeId, sourceId)
  );

  CREATE INDEX IF NOT EXISTS idx_pois_route_category ON pois(routeId, category);
  CREATE INDEX IF NOT EXISTS idx_pois_route_along ON pois(routeId, distanceAlongRouteMeters);

  CREATE TABLE IF NOT EXISTS races (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    isActive INTEGER NOT NULL DEFAULT 0,
    createdAt TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS race_segments (
    raceId TEXT NOT NULL REFERENCES races(id) ON DELETE CASCADE,
    routeId TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    isSelected INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (raceId, routeId)
  );

  CREATE INDEX IF NOT EXISTS idx_race_segments_race_pos ON race_segments(raceId, position);
`);

// --- Helpers ---

function toRoute(row: typeof routes.$inferSelect): Route {
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    color: row.color,
    isActive: row.isActive,
    isVisible: row.isVisible,
    totalDistanceMeters: row.totalDistanceMeters,
    totalAscentMeters: row.totalAscentMeters,
    totalDescentMeters: row.totalDescentMeters,
    pointCount: row.pointCount,
    createdAt: row.createdAt,
  };
}

function toPoint(row: typeof routePoints.$inferSelect): RoutePoint {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    elevationMeters: row.elevationMeters,
    distanceFromStartMeters: row.distanceFromStartMeters,
    index: row.idx,
  };
}

function toPOI(row: typeof pois.$inferSelect): POI {
  return {
    id: row.id,
    sourceId: row.sourceId,
    source: row.source as POI["source"],
    name: row.name,
    category: row.category as POICategory,
    latitude: row.latitude,
    longitude: row.longitude,
    tags: row.tags as Record<string, string>,
    distanceFromRouteMeters: row.distanceFromRouteMeters,
    distanceAlongRouteMeters: row.distanceAlongRouteMeters,
    nearestRouteId: row.routeId,
  };
}

function toRace(row: typeof races.$inferSelect): Race {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

function toRaceSegment(row: typeof raceSegments.$inferSelect): RaceSegment {
  return {
    raceId: row.raceId,
    routeId: row.routeId,
    position: row.position,
    isSelected: row.isSelected,
  };
}

// --- Route CRUD ---

export async function insertRoute(
  route: Route,
  points: RoutePoint[],
): Promise<void> {
  db.transaction((tx) => {
    tx.insert(routes).values({
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
    }).run();

    const CHUNK = 500;
    for (let i = 0; i < points.length; i += CHUNK) {
      const chunk = points.slice(i, i + CHUNK);
      tx.insert(routePoints).values(
        chunk.map((p) => ({
          routeId: route.id,
          idx: p.index,
          latitude: p.latitude,
          longitude: p.longitude,
          elevationMeters: p.elevationMeters,
          distanceFromStartMeters: p.distanceFromStartMeters,
        })),
      ).run();
    }
  });
}

export async function getAllRoutes(): Promise<Route[]> {
  const rows = db.select().from(routes).orderBy(desc(routes.createdAt)).all();
  return rows.map(toRoute);
}

export async function getRoute(routeId: string): Promise<Route | null> {
  const row = db.select().from(routes).where(eq(routes.id, routeId)).get();
  return row ? toRoute(row) : null;
}

export async function getRouteWithPoints(routeId: string): Promise<RouteWithPoints | null> {
  const row = db.select().from(routes).where(eq(routes.id, routeId)).get();
  if (!row) return null;

  const pointRows = db
    .select()
    .from(routePoints)
    .where(eq(routePoints.routeId, routeId))
    .orderBy(asc(routePoints.idx))
    .all();

  return {
    ...toRoute(row),
    points: pointRows.map(toPoint),
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
  return {
    first: toPoint(first as typeof routePoints.$inferSelect),
    last: toPoint(last as typeof routePoints.$inferSelect),
  };
}

export async function getRoutePoints(routeId: string): Promise<RoutePoint[]> {
  const rows = db
    .select()
    .from(routePoints)
    .where(eq(routePoints.routeId, routeId))
    .orderBy(asc(routePoints.idx))
    .all();
  return rows.map(toPoint);
}

export async function deleteRoute(routeId: string): Promise<void> {
  // Foreign keys with ON DELETE CASCADE handle route_points, pois, and race_segments
  db.delete(routes).where(eq(routes.id, routeId)).run();
}

export async function updateRouteVisibility(
  routeId: string,
  isVisible: boolean,
): Promise<void> {
  db.update(routes).set({ isVisible }).where(eq(routes.id, routeId)).run();
}

export async function setRoutesVisible(routeIds: string[]): Promise<void> {
  if (routeIds.length === 0) return;
  db.update(routes).set({ isVisible: true }).where(inArray(routes.id, routeIds)).run();
}

export async function setActiveRoute(routeId: string): Promise<void> {
  db.transaction((tx) => {
    tx.update(races).set({ isActive: false }).run();
    tx.update(routes).set({ isActive: false }).run();
    tx.update(routes).set({ isActive: true, isVisible: true }).where(eq(routes.id, routeId)).run();
  });
}

// --- POI CRUD ---

export async function insertPOIs(newPois: POI[]): Promise<void> {
  if (newPois.length === 0) return;

  db.transaction((tx) => {
    const CHUNK = 500;
    for (let i = 0; i < newPois.length; i += CHUNK) {
      const chunk = newPois.slice(i, i + CHUNK);
      tx.insert(pois).values(
        chunk.map((p) => ({
          id: p.id,
          sourceId: p.sourceId,
          source: p.source,
          routeId: p.nearestRouteId,
          name: p.name,
          category: p.category,
          latitude: p.latitude,
          longitude: p.longitude,
          tags: p.tags,
          distanceFromRouteMeters: p.distanceFromRouteMeters,
          distanceAlongRouteMeters: p.distanceAlongRouteMeters,
        })),
      ).onConflictDoUpdate({
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
      }).run();
    }
  });
}

export async function getPOIsForRoute(
  routeId: string,
  categories?: POICategory[],
  maxDistFromRoute?: number,
): Promise<POI[]> {
  let query = db.select().from(pois).where(eq(pois.routeId, routeId)).$dynamic();

  if (categories && categories.length > 0) {
    query = query.where(and(eq(pois.routeId, routeId), inArray(pois.category, categories)));
  }

  if (maxDistFromRoute != null) {
    const existing = categories && categories.length > 0
      ? and(eq(pois.routeId, routeId), inArray(pois.category, categories))
      : eq(pois.routeId, routeId);
    query = db.select().from(pois).where(and(existing, sql`${pois.distanceFromRouteMeters} <= ${maxDistFromRoute}`)).$dynamic();
  }

  const rows = query.orderBy(asc(pois.distanceAlongRouteMeters)).all();
  return rows.map(toPOI);
}

export async function deletePOIsForRoute(routeId: string): Promise<void> {
  db.delete(pois).where(eq(pois.routeId, routeId)).run();
}

export async function deletePOIsBySource(routeId: string, source: string): Promise<void> {
  db.delete(pois).where(and(eq(pois.routeId, routeId), eq(pois.source, source))).run();
}

export async function hasPOIsForRoute(routeId: string): Promise<boolean> {
  const row = db
    .select({ count: count() })
    .from(pois)
    .where(eq(pois.routeId, routeId))
    .get();
  return (row?.count ?? 0) > 0;
}

export async function getPOICountsBySource(routeId: string): Promise<{ osm: number; google: number }> {
  const rows = db
    .select({ source: pois.source, cnt: count() })
    .from(pois)
    .where(eq(pois.routeId, routeId))
    .groupBy(pois.source)
    .all();

  let osm = 0, google = 0;
  for (const row of rows) {
    if (row.source === "google") google = row.cnt;
    else osm += row.cnt;
  }
  return { osm, google };
}

// --- Race CRUD ---

export async function insertRace(race: Race): Promise<void> {
  db.insert(races).values({
    id: race.id,
    name: race.name,
    isActive: race.isActive,
    createdAt: race.createdAt,
  }).run();
}

export async function getAllRaces(): Promise<Race[]> {
  const rows = db.select().from(races).orderBy(desc(races.createdAt)).all();
  return rows.map(toRace);
}

export async function deleteRace(raceId: string): Promise<void> {
  // Foreign keys with ON DELETE CASCADE handle race_segments
  db.delete(races).where(eq(races.id, raceId)).run();
}

export async function renameRace(raceId: string, name: string): Promise<void> {
  db.update(races).set({ name }).where(eq(races.id, raceId)).run();
}

export async function setActiveRace(raceId: string): Promise<void> {
  db.transaction((tx) => {
    tx.update(routes).set({ isActive: false }).run();
    tx.update(races).set({ isActive: false }).run();
    tx.update(races).set({ isActive: true }).where(eq(races.id, raceId)).run();
  });
}

export async function clearActiveRace(): Promise<void> {
  db.update(races).set({ isActive: false }).run();
}

// --- Race Segment CRUD ---

export async function insertRaceSegment(segment: RaceSegment): Promise<void> {
  db.insert(raceSegments).values({
    raceId: segment.raceId,
    routeId: segment.routeId,
    position: segment.position,
    isSelected: segment.isSelected,
  }).run();
}

export async function deleteRaceSegment(
  raceId: string,
  routeId: string,
): Promise<void> {
  db.delete(raceSegments)
    .where(and(eq(raceSegments.raceId, raceId), eq(raceSegments.routeId, routeId)))
    .run();
}

export async function getRaceSegments(
  raceId: string,
): Promise<RaceSegment[]> {
  const rows = db
    .select()
    .from(raceSegments)
    .where(eq(raceSegments.raceId, raceId))
    .orderBy(asc(raceSegments.position), desc(raceSegments.isSelected))
    .all();
  return rows.map(toRaceSegment);
}

export async function selectVariant(
  raceId: string,
  routeId: string,
): Promise<void> {
  const row = db
    .select({ position: raceSegments.position })
    .from(raceSegments)
    .where(and(eq(raceSegments.raceId, raceId), eq(raceSegments.routeId, routeId)))
    .get();
  if (!row) return;

  db.transaction((tx) => {
    tx.update(raceSegments)
      .set({ isSelected: false })
      .where(and(eq(raceSegments.raceId, raceId), eq(raceSegments.position, row.position)))
      .run();
    tx.update(raceSegments)
      .set({ isSelected: true })
      .where(and(eq(raceSegments.raceId, raceId), eq(raceSegments.routeId, routeId)))
      .run();
  });
}

export async function updateSegmentPositions(
  raceId: string,
  positions: { routeId: string; position: number }[],
): Promise<void> {
  db.transaction((tx) => {
    for (const { routeId, position } of positions) {
      tx.update(raceSegments)
        .set({ position })
        .where(and(eq(raceSegments.raceId, raceId), eq(raceSegments.routeId, routeId)))
        .run();
    }
  });
}

export async function getAllAssignedRouteIds(): Promise<Set<string>> {
  const rows = db
    .selectDistinct({ routeId: raceSegments.routeId })
    .from(raceSegments)
    .all();
  return new Set(rows.map((r) => r.routeId));
}

export async function getMaxSegmentPosition(raceId: string): Promise<number> {
  const row = db
    .select({ maxPos: max(raceSegments.position) })
    .from(raceSegments)
    .where(eq(raceSegments.raceId, raceId))
    .get();
  return row?.maxPos ?? -1;
}
