export const FERRY_CROSSINGS_MIGRATION_CREATED_AT = 1784372400000;

export function shouldPrepareFerryCrossingsSchema(latestMigrationCreatedAt: number): boolean {
  return (
    Number.isFinite(latestMigrationCreatedAt) &&
    latestMigrationCreatedAt <= FERRY_CROSSINGS_MIGRATION_CREATED_AT
  );
}

const REQUIRED_FERRY_CROSSING_COLUMNS = [
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
] as const;

interface SQLiteColumnInfo {
  name: string;
  notnull?: number;
  dflt_value?: unknown;
  pk?: number;
}

interface SQLiteForeignKeyInfo {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

export function hasSupportedFerryCrossingsSchema(
  columns: readonly SQLiteColumnInfo[],
  foreignKeys: readonly SQLiteForeignKeyInfo[],
): boolean {
  const columnNames = new Set(columns.map((column) => column.name));
  if (!REQUIRED_FERRY_CROSSING_COLUMNS.every((column) => columnNames.has(column))) return false;

  const primaryKeyColumns = columns.filter((column) => (column.pk ?? 0) > 0);
  if (primaryKeyColumns.length !== 1 || primaryKeyColumns[0].name !== "id") return false;

  const requiredColumnNames = new Set<string>(REQUIRED_FERRY_CROSSING_COLUMNS);
  const blockingExtraColumn = columns.some(
    (column) =>
      !requiredColumnNames.has(column.name) && column.notnull === 1 && column.dflt_value == null,
  );
  if (blockingExtraColumn) return false;

  return foreignKeys.some(
    (foreignKey) =>
      foreignKey.from === "routeId" &&
      foreignKey.table === "routes" &&
      foreignKey.to === "id" &&
      foreignKey.on_delete.toUpperCase() === "CASCADE",
  );
}
