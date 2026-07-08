CREATE TABLE IF NOT EXISTS `relative_eta_cache` (
	`cacheKey` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`scopeId` text NOT NULL,
	`signature` text NOT NULL,
	`powerConfigKey` text NOT NULL,
	`algorithmVersion` integer NOT NULL,
	`pointCount` integer NOT NULL,
	`totalDurationSeconds` real NOT NULL,
	`cumulativeSeconds` blob NOT NULL,
	`updatedAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_relative_eta_cache_scope` ON `relative_eta_cache` (`scope`,`scopeId`);
