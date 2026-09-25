import type {
  Collection,
  CollectionSegment,
  FerryCrossing,
  POI,
  POIFetchedSource,
  POISource,
  Route,
  RoutePoint,
  StarredItem,
} from "@/types";

export const PLANNING_TRANSPORT_VERSION = 2;
export const PLANNER_FETCHED_SOURCES_METADATA_KEY = "planner_fetched_sources";
export const PLANNING_EXPORT_FILE_NAME = "ultra-plan.ultra-plan.db";
export const PLANNING_SQLITE_MIME_TYPE = "application/x-sqlite3";

export const PLANNING_METADATA_TABLE = "planning_metadata";
export const REQUIRED_PLANNING_TABLES = [
  PLANNING_METADATA_TABLE,
  "routes",
  "route_points",
  "collections",
  "collection_segments",
  "pois",
  "starred_items",
  "climbs",
] as const;

const SQLITE_HEADER_BYTES = [
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
];
const SQLITE_WRITE_VERSION_OFFSET = 18;
const SQLITE_READ_VERSION_OFFSET = 19;
const SQLITE_ROLLBACK_JOURNAL_VERSION = 1;
const SQLITE_WAL_JOURNAL_VERSION = 2;

type RawBoolean = boolean | number;

export interface RawRouteRow extends Omit<Route, "isActive" | "isVisible"> {
  isActive: RawBoolean;
  isVisible: RawBoolean;
}

export interface RawCollectionRow extends Omit<Collection, "isActive"> {
  isActive: RawBoolean;
}

export interface RawCollectionSegmentRow extends Omit<
  CollectionSegment,
  "isSelected" | "variantKind"
> {
  isSelected: RawBoolean;
  variantKind: string;
}

export interface RawPOIRow extends Omit<POI, "source" | "category" | "tags"> {
  source: string;
  category: string;
  tags: string | Record<string, string>;
}

export interface RawStarredItemRow extends Omit<StarredItem, "entityType"> {
  entityType: string;
}

export interface RawFerryCrossingRow extends Omit<
  FerryCrossing,
  "source" | "bicycleAccess" | "providerRefs" | "tags"
> {
  source: string;
  bicycleAccess: string;
  providerRefs: string | Record<string, string>;
  tags: string | Record<string, string>;
}

export type ImportedRoutePoint = RoutePoint & { routeId: string };

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
  ferries: number;
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

export function normalizeSQLiteTransportBytes(bytes: Uint8Array): Uint8Array {
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

function parseStringRecord(value: string | Record<string, string>): Record<string, string> {
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

export function normalizeRoute(row: RawRouteRow): Route {
  return {
    ...row,
    isActive: toBoolean(row.isActive),
    isVisible: toBoolean(row.isVisible),
  };
}

export function normalizeCollection(row: RawCollectionRow): Collection {
  return {
    ...row,
    isActive: toBoolean(row.isActive),
  };
}

export function normalizeCollectionSegment(row: RawCollectionSegmentRow): CollectionSegment {
  return {
    ...row,
    isSelected: toBoolean(row.isSelected),
    variantKind: row.variantKind === "patch" ? "patch" : "full",
  };
}

export function normalizePOI(row: RawPOIRow): POI {
  return {
    ...row,
    source: row.source as POISource,
    category: row.category as POI["category"],
    tags: parseStringRecord(row.tags),
  };
}

export function normalizeFerryCrossing(row: RawFerryCrossingRow): FerryCrossing {
  return {
    ...row,
    source: row.source === "osm" ? "osm" : "manual",
    bicycleAccess:
      row.bicycleAccess === "yes" || row.bicycleAccess === "no" ? row.bicycleAccess : "unknown",
    providerRefs: parseStringRecord(row.providerRefs),
    tags: parseStringRecord(row.tags),
  };
}

export function normalizeStarredItem(row: RawStarredItemRow): StarredItem | null {
  if (row.entityType !== "poi") return null;
  return { ...row, entityType: "poi" };
}

export function parsePlannerFetchedSources(value: string | null): PlannerFetchedSourcePair[] {
  const raw = safeJsonParse<PlannerFetchedSourcePair[]>(value, []);
  return raw.filter((pair) => pair.routeId && isFetchedSource(pair.source));
}

export function parsePlanningTransportVersion(value: string | null): 1 | 2 {
  const version = Number(value);
  if (version !== 1 && version !== PLANNING_TRANSPORT_VERSION) {
    throw new Error(
      `Unsupported planning database version ${version || "unknown"}. Expected 1 or ${PLANNING_TRANSPORT_VERSION}.`,
    );
  }
  return version;
}
