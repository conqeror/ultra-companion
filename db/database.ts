import * as SQLite from "expo-sqlite";
import type { Route, RoutePoint, RouteWithPoints, POI, POICategory, Race, RaceSegment } from "@/types";

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync("ultra.db");
  await db.execAsync(`PRAGMA journal_mode = WAL;`);
  await createTables(db);
  return db;
}

async function createTables(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
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
      routeId TEXT NOT NULL,
      idx INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      elevationMeters REAL,
      distanceFromStartMeters REAL NOT NULL,
      PRIMARY KEY (routeId, idx),
      FOREIGN KEY (routeId) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pois (
      id TEXT PRIMARY KEY,
      osmId TEXT NOT NULL,
      routeId TEXT NOT NULL,
      name TEXT,
      category TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      tags TEXT NOT NULL,
      distanceFromRouteMeters REAL NOT NULL,
      distanceAlongRouteMeters REAL NOT NULL,
      FOREIGN KEY (routeId) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_pois_route_category
      ON pois(routeId, category);

    CREATE INDEX IF NOT EXISTS idx_pois_route_along
      ON pois(routeId, distanceAlongRouteMeters);

    CREATE TABLE IF NOT EXISTS races (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      isActive INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS race_segments (
      raceId TEXT NOT NULL,
      routeId TEXT NOT NULL,
      position INTEGER NOT NULL,
      isSelected INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (raceId, routeId),
      FOREIGN KEY (raceId) REFERENCES races(id) ON DELETE CASCADE,
      FOREIGN KEY (routeId) REFERENCES routes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_race_segments_race_pos
      ON race_segments(raceId, position);
  `);
}

// --- Route CRUD ---

export async function insertRoute(
  route: Route,
  points: RoutePoint[],
): Promise<void> {
  const database = await getDatabase();

  await database.runAsync(
    `INSERT INTO routes (id, name, fileName, color, isActive, isVisible, totalDistanceMeters, totalAscentMeters, totalDescentMeters, pointCount, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    route.id,
    route.name,
    route.fileName,
    route.color,
    route.isActive ? 1 : 0,
    route.isVisible ? 1 : 0,
    route.totalDistanceMeters,
    route.totalAscentMeters,
    route.totalDescentMeters,
    route.pointCount,
    route.createdAt,
  );

  // Batch insert points in chunks of 100
  const CHUNK = 100;
  for (let i = 0; i < points.length; i += CHUNK) {
    const chunk = points.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
    const values = chunk.flatMap((p) => [
      route.id,
      p.index,
      p.latitude,
      p.longitude,
      p.elevationMeters,
      p.distanceFromStartMeters,
    ]);

    await database.runAsync(
      `INSERT INTO route_points (routeId, idx, latitude, longitude, elevationMeters, distanceFromStartMeters) VALUES ${placeholders}`,
      ...values,
    );
  }
}

export async function getAllRoutes(): Promise<Route[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM routes ORDER BY createdAt DESC`,
  );
  return rows.map(rowToRoute);
}

export async function getRoute(routeId: string): Promise<Route | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    `SELECT * FROM routes WHERE id = ?`,
    routeId,
  );
  return row ? rowToRoute(row) : null;
}

export async function getRouteWithPoints(routeId: string): Promise<RouteWithPoints | null> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<any>(
    `SELECT * FROM routes WHERE id = ?`,
    routeId,
  );
  if (!row) return null;

  const pointRows = await database.getAllAsync<any>(
    `SELECT * FROM route_points WHERE routeId = ? ORDER BY idx`,
    routeId,
  );

  return {
    ...rowToRoute(row),
    points: pointRows.map(rowToPoint),
  };
}

export async function getRouteEndpoints(
  routeId: string,
): Promise<{ first: RoutePoint; last: RoutePoint } | null> {
  const database = await getDatabase();
  const first = await database.getFirstAsync<any>(
    `SELECT * FROM route_points WHERE routeId = ? ORDER BY idx ASC LIMIT 1`,
    routeId,
  );
  const last = await database.getFirstAsync<any>(
    `SELECT * FROM route_points WHERE routeId = ? ORDER BY idx DESC LIMIT 1`,
    routeId,
  );
  if (!first || !last) return null;
  return { first: rowToPoint(first), last: rowToPoint(last) };
}

export async function getRoutePoints(routeId: string): Promise<RoutePoint[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM route_points WHERE routeId = ? ORDER BY idx`,
    routeId,
  );
  return rows.map(rowToPoint);
}

export async function deleteRoute(routeId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM pois WHERE routeId = ?`, routeId);
  await database.runAsync(`DELETE FROM route_points WHERE routeId = ?`, routeId);
  await database.runAsync(`DELETE FROM routes WHERE id = ?`, routeId);
}

export async function updateRouteVisibility(
  routeId: string,
  isVisible: boolean,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE routes SET isVisible = ? WHERE id = ?`,
    isVisible ? 1 : 0,
    routeId,
  );
}

export async function setRoutesVisible(routeIds: string[]): Promise<void> {
  if (routeIds.length === 0) return;
  const database = await getDatabase();
  const placeholders = routeIds.map(() => "?").join(", ");
  await database.runAsync(
    `UPDATE routes SET isVisible = 1 WHERE id IN (${placeholders})`,
    ...routeIds,
  );
}

export async function setActiveRoute(routeId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE races SET isActive = 0`);
  await database.runAsync(`UPDATE routes SET isActive = 0`);
  await database.runAsync(
    `UPDATE routes SET isActive = 1, isVisible = 1 WHERE id = ?`,
    routeId,
  );
}

// --- Row mappers ---

function rowToRoute(row: any): Route {
  return {
    id: row.id,
    name: row.name,
    fileName: row.fileName,
    color: row.color,
    isActive: row.isActive === 1,
    isVisible: row.isVisible === 1,
    totalDistanceMeters: row.totalDistanceMeters,
    totalAscentMeters: row.totalAscentMeters,
    totalDescentMeters: row.totalDescentMeters,
    pointCount: row.pointCount,
    createdAt: row.createdAt,
  };
}

function rowToPoint(row: any): RoutePoint {
  return {
    latitude: row.latitude,
    longitude: row.longitude,
    elevationMeters: row.elevationMeters,
    distanceFromStartMeters: row.distanceFromStartMeters,
    index: row.idx,
  };
}

// --- POI CRUD ---

export async function insertPOIs(pois: POI[]): Promise<void> {
  if (pois.length === 0) return;
  const database = await getDatabase();

  const CHUNK = 100;
  for (let i = 0; i < pois.length; i += CHUNK) {
    const chunk = pois.slice(i, i + CHUNK);
    const placeholders = chunk
      .map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .join(", ");
    const values = chunk.flatMap((p) => [
      p.id,
      p.osmId,
      p.nearestRouteId,
      p.name,
      p.category,
      p.latitude,
      p.longitude,
      JSON.stringify(p.tags),
      p.distanceFromRouteMeters,
      p.distanceAlongRouteMeters,
    ]);

    await database.runAsync(
      `INSERT OR REPLACE INTO pois (id, osmId, routeId, name, category, latitude, longitude, tags, distanceFromRouteMeters, distanceAlongRouteMeters) VALUES ${placeholders}`,
      ...values,
    );
  }
}

export async function getPOIsForRoute(
  routeId: string,
  categories?: POICategory[],
  maxDistFromRoute?: number,
): Promise<POI[]> {
  const database = await getDatabase();

  let sql = `SELECT * FROM pois WHERE routeId = ?`;
  const params: any[] = [routeId];

  if (categories && categories.length > 0) {
    const placeholders = categories.map(() => "?").join(", ");
    sql += ` AND category IN (${placeholders})`;
    params.push(...categories);
  }

  if (maxDistFromRoute != null) {
    sql += ` AND distanceFromRouteMeters <= ?`;
    params.push(maxDistFromRoute);
  }

  sql += ` ORDER BY distanceAlongRouteMeters`;

  const rows = await database.getAllAsync<any>(sql, ...params);
  return rows.map(rowToPOI);
}

export async function deletePOIsForRoute(routeId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM pois WHERE routeId = ?`, routeId);
}

export async function hasPOIsForRoute(routeId: string): Promise<boolean> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM pois WHERE routeId = ?`,
    routeId,
  );
  return (row?.count ?? 0) > 0;
}

function rowToPOI(row: any): POI {
  return {
    id: row.id,
    osmId: row.osmId,
    name: row.name,
    category: row.category,
    latitude: row.latitude,
    longitude: row.longitude,
    tags: JSON.parse(row.tags),
    distanceFromRouteMeters: row.distanceFromRouteMeters,
    distanceAlongRouteMeters: row.distanceAlongRouteMeters,
    nearestRouteId: row.routeId,
  };
}

// --- Race CRUD ---

export async function insertRace(race: Race): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO races (id, name, isActive, createdAt) VALUES (?, ?, ?, ?)`,
    race.id,
    race.name,
    race.isActive ? 1 : 0,
    race.createdAt,
  );
}

export async function getAllRaces(): Promise<Race[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM races ORDER BY createdAt DESC`,
  );
  return rows.map(rowToRace);
}

export async function deleteRace(raceId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`DELETE FROM race_segments WHERE raceId = ?`, raceId);
  await database.runAsync(`DELETE FROM races WHERE id = ?`, raceId);
}

export async function renameRace(raceId: string, name: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `UPDATE races SET name = ? WHERE id = ?`,
    name,
    raceId,
  );
}

export async function setActiveRace(raceId: string): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE routes SET isActive = 0`);
  await database.runAsync(`UPDATE races SET isActive = 0`);
  await database.runAsync(
    `UPDATE races SET isActive = 1 WHERE id = ?`,
    raceId,
  );
}

export async function clearActiveRace(): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(`UPDATE races SET isActive = 0`);
}

// --- Race Segment CRUD ---

export async function insertRaceSegment(segment: RaceSegment): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `INSERT INTO race_segments (raceId, routeId, position, isSelected) VALUES (?, ?, ?, ?)`,
    segment.raceId,
    segment.routeId,
    segment.position,
    segment.isSelected ? 1 : 0,
  );
}

export async function deleteRaceSegment(
  raceId: string,
  routeId: string,
): Promise<void> {
  const database = await getDatabase();
  await database.runAsync(
    `DELETE FROM race_segments WHERE raceId = ? AND routeId = ?`,
    raceId,
    routeId,
  );
}

export async function getRaceSegments(
  raceId: string,
): Promise<RaceSegment[]> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<any>(
    `SELECT * FROM race_segments WHERE raceId = ? ORDER BY position, isSelected DESC`,
    raceId,
  );
  return rows.map(rowToRaceSegment);
}

export async function selectVariant(
  raceId: string,
  routeId: string,
): Promise<void> {
  const database = await getDatabase();
  // Get position of this segment
  const row = await database.getFirstAsync<any>(
    `SELECT position FROM race_segments WHERE raceId = ? AND routeId = ?`,
    raceId,
    routeId,
  );
  if (!row) return;
  const position = row.position;
  // Deselect all at this position, then select the target
  await database.runAsync(
    `UPDATE race_segments SET isSelected = 0 WHERE raceId = ? AND position = ?`,
    raceId,
    position,
  );
  await database.runAsync(
    `UPDATE race_segments SET isSelected = 1 WHERE raceId = ? AND routeId = ?`,
    raceId,
    routeId,
  );
}

export async function updateSegmentPositions(
  raceId: string,
  positions: { routeId: string; position: number }[],
): Promise<void> {
  const database = await getDatabase();
  for (const { routeId, position } of positions) {
    await database.runAsync(
      `UPDATE race_segments SET position = ? WHERE raceId = ? AND routeId = ?`,
      position,
      raceId,
      routeId,
    );
  }
}

export async function getAllAssignedRouteIds(): Promise<Set<string>> {
  const database = await getDatabase();
  const rows = await database.getAllAsync<{ routeId: string }>(
    `SELECT DISTINCT routeId FROM race_segments`,
  );
  return new Set(rows.map((r) => r.routeId));
}

export async function getMaxSegmentPosition(raceId: string): Promise<number> {
  const database = await getDatabase();
  const row = await database.getFirstAsync<{ maxPos: number | null }>(
    `SELECT MAX(position) as maxPos FROM race_segments WHERE raceId = ?`,
    raceId,
  );
  return row?.maxPos ?? -1;
}

// --- Race row mappers ---

function rowToRace(row: any): Race {
  return {
    id: row.id,
    name: row.name,
    isActive: row.isActive === 1,
    createdAt: row.createdAt,
  };
}

function rowToRaceSegment(row: any): RaceSegment {
  return {
    raceId: row.raceId,
    routeId: row.routeId,
    position: row.position,
    isSelected: row.isSelected === 1,
  };
}
