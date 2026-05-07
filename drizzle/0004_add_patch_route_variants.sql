ALTER TABLE `collection_segments` ADD `variantKind` text DEFAULT 'full' NOT NULL;--> statement-breakpoint
ALTER TABLE `collection_segments` ADD `baseRouteId` text REFERENCES routes(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `collection_segments` ADD `replaceStartDistanceMeters` real;--> statement-breakpoint
ALTER TABLE `collection_segments` ADD `replaceEndDistanceMeters` real;--> statement-breakpoint
CREATE INDEX `idx_collection_segments_base_route` ON `collection_segments` (`collectionId`,`baseRouteId`);
