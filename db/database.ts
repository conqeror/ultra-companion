import * as SQLite from "expo-sqlite";
import type { Route, RoutePoint, RouteWithPoints, POI, POICategory } from "@/types";

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

export async function setActiveRoute(routeId: string): Promise<void> {
  const database = await getDatabase();
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
