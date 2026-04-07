import { sqliteTable, text, integer, real, index, unique, primaryKey } from "drizzle-orm/sqlite-core";
import type { POICategory, POISource } from "@/types";

// --- Climbs ---

export const climbs = sqliteTable("climbs", {
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
}, (table) => [
  index("idx_climbs_route_distance").on(table.routeId, table.startDistanceMeters),
]);

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

export const routePoints = sqliteTable("route_points", {
  routeId: text("routeId")
    .notNull()
    .references(() => routes.id, { onDelete: "cascade" }),
  idx: integer("idx").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  elevationMeters: real("elevationMeters"),
  distanceFromStartMeters: real("distanceFromStartMeters").notNull(),
}, (table) => [
  primaryKey({ columns: [table.routeId, table.idx] }),
]);

// --- POIs ---

export const pois = sqliteTable("pois", {
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
}, (table) => [
  index("idx_pois_route_category").on(table.routeId, table.category),
  index("idx_pois_route_along").on(table.routeId, table.distanceAlongRouteMeters),
  index("idx_pois_route_source").on(table.routeId, table.source),
  unique("uq_pois_route_source").on(table.routeId, table.sourceId),
]);

// --- Collections ---

export const collections = sqliteTable("collections", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  isActive: integer("isActive", { mode: "boolean" }).notNull().default(false),
  createdAt: text("createdAt").notNull(),
});

// --- Collection Segments ---

export const collectionSegments = sqliteTable("collection_segments", {
  collectionId: text("collectionId")
    .notNull()
    .references(() => collections.id, { onDelete: "cascade" }),
  routeId: text("routeId")
    .notNull()
    .references(() => routes.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  isSelected: integer("isSelected", { mode: "boolean" }).notNull().default(true),
}, (table) => [
  primaryKey({ columns: [table.collectionId, table.routeId] }),
  index("idx_collection_segments_col_pos").on(table.collectionId, table.position),
]);
