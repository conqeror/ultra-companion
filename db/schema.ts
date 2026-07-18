import {
  sqliteTable,
  text,
  integer,
  real,
  blob,
  index,
  unique,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import type {
  FerryBicycleAccess,
  FerryCrossingSource,
  POICategory,
  POISource,
  StarredEntityType,
} from "@/types";

// --- Planning Transport Metadata ---

export const planningMetadata = sqliteTable("planning_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: text("updatedAt").notNull(),
});

// --- Derived Data ---

export const relativeEtaCache = sqliteTable(
  "relative_eta_cache",
  {
    cacheKey: text("cacheKey").primaryKey(),
    scope: text("scope").notNull(),
    scopeId: text("scopeId").notNull(),
    signature: text("signature").notNull(),
    powerConfigKey: text("powerConfigKey").notNull(),
    algorithmVersion: integer("algorithmVersion").notNull(),
    pointCount: integer("pointCount").notNull(),
    totalDurationSeconds: real("totalDurationSeconds").notNull(),
    cumulativeSeconds: blob("cumulativeSeconds", { mode: "buffer" }).notNull().$type<Uint8Array>(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [index("idx_relative_eta_cache_scope").on(table.scope, table.scopeId)],
);

// --- Climbs ---

export const climbs = sqliteTable(
  "climbs",
  {
    id: text("id").primaryKey(),
    routeId: text("routeId")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    name: text("name"),
    startDistanceMeters: real("startDistanceMeters").notNull(),
    endDistanceMeters: real("endDistanceMeters").notNull(),
    lengthMeters: real("lengthMeters").notNull(),
    totalAscentMeters: real("totalAscentMeters").notNull(),
    startElevationMeters: real("startElevationMeters").notNull(),
    endElevationMeters: real("endElevationMeters").notNull(),
    averageGradientPercent: real("averageGradientPercent").notNull(),
    maxGradientPercent: real("maxGradientPercent").notNull(),
    difficultyScore: real("difficultyScore").notNull(),
  },
  (table) => [index("idx_climbs_route_distance").on(table.routeId, table.startDistanceMeters)],
);

// --- Routes ---

export const routes = sqliteTable("routes", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  fileName: text("fileName").notNull(),
  color: text("color").notNull(),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(false),
  isVisible: integer("isVisible", { mode: "boolean" }).notNull().default(true),
  totalDistanceMeters: real("totalDistanceMeters").notNull(),
  totalAscentMeters: real("totalAscentMeters").notNull(),
  totalDescentMeters: real("totalDescentMeters").notNull(),
  pointCount: integer("pointCount").notNull(),
  createdAt: text("createdAt").notNull(),
});

// --- Route Points ---

export const routePoints = sqliteTable(
  "route_points",
  {
    routeId: text("routeId")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    idx: integer("idx").notNull(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    elevationMeters: real("elevationMeters"),
    distanceFromStartMeters: real("distanceFromStartMeters").notNull(),
  },
  (table) => [primaryKey({ columns: [table.routeId, table.idx] })],
);

// --- Ferry Crossings ---

export const ferryCrossings = sqliteTable(
  "ferry_crossings",
  {
    id: text("id").primaryKey(),
    routeId: text("routeId")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    startDistanceMeters: real("startDistanceMeters").notNull(),
    endDistanceMeters: real("endDistanceMeters").notNull(),
    startLatitude: real("startLatitude").notNull(),
    startLongitude: real("startLongitude").notNull(),
    endLatitude: real("endLatitude").notNull(),
    endLongitude: real("endLongitude").notNull(),
    durationMinutes: real("durationMinutes").notNull(),
    assumedWaitMinutes: real("assumedWaitMinutes").notNull().default(0),
    boardingBufferMinutes: real("boardingBufferMinutes").notNull().default(0),
    source: text("source").notNull().default("manual").$type<FerryCrossingSource>(),
    sourceId: text("sourceId"),
    sourceUrl: text("sourceUrl"),
    operator: text("operator"),
    timetableUrl: text("timetableUrl"),
    bicycleAccess: text("bicycleAccess").notNull().default("unknown").$type<FerryBicycleAccess>(),
    providerRefs: text("providerRefs", { mode: "json" }).notNull().$type<Record<string, string>>(),
    tags: text("tags", { mode: "json" }).notNull().$type<Record<string, string>>(),
    createdAt: text("createdAt").notNull(),
    updatedAt: text("updatedAt").notNull(),
  },
  (table) => [
    index("idx_ferry_crossings_route_start").on(table.routeId, table.startDistanceMeters),
  ],
);

// --- POIs ---

export const pois = sqliteTable(
  "pois",
  {
    id: text("id").primaryKey(),
    sourceId: text("sourceId").notNull(),
    source: text("source").notNull().default("osm").$type<POISource>(),
    routeId: text("routeId")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    name: text("name"),
    category: text("category").notNull().$type<POICategory>(),
    latitude: real("latitude").notNull(),
    longitude: real("longitude").notNull(),
    tags: text("tags", { mode: "json" }).notNull().$type<Record<string, string>>(),
    distanceFromRouteMeters: real("distanceFromRouteMeters").notNull(),
    distanceAlongRouteMeters: real("distanceAlongRouteMeters").notNull(),
  },
  (table) => [
    index("idx_pois_route_category").on(table.routeId, table.category),
    index("idx_pois_route_along").on(table.routeId, table.distanceAlongRouteMeters),
    index("idx_pois_route_source").on(table.routeId, table.source),
    unique("uq_pois_route_source").on(table.routeId, table.sourceId),
  ],
);

// --- Starred Items ---

export const starredItems = sqliteTable(
  "starred_items",
  {
    entityType: text("entityType").notNull().$type<StarredEntityType>(),
    entityId: text("entityId").notNull(),
    createdAt: text("createdAt").notNull(),
  },
  (table) => [primaryKey({ columns: [table.entityType, table.entityId] })],
);

// --- Collections ---

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(false),
  createdAt: text("createdAt").notNull(),
  plannedStartMs: integer("plannedStartMs"),
});

// --- Collection Segments ---

export const collectionSegments = sqliteTable(
  "collection_segments",
  {
    collectionId: text("collectionId")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    routeId: text("routeId")
      .notNull()
      .references(() => routes.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    isSelected: integer("isSelected", { mode: "boolean" }).notNull().default(true),
    variantKind: text("variantKind").notNull().default("full"),
    baseRouteId: text("baseRouteId").references(() => routes.id, { onDelete: "cascade" }),
    replaceStartDistanceMeters: real("replaceStartDistanceMeters"),
    replaceEndDistanceMeters: real("replaceEndDistanceMeters"),
  },
  (table) => [
    primaryKey({ columns: [table.collectionId, table.routeId] }),
    index("idx_collection_segments_col_pos").on(table.collectionId, table.position),
    index("idx_collection_segments_base_route").on(table.collectionId, table.baseRouteId),
  ],
);
