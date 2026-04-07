CREATE TABLE `climbs` (
	`id` text PRIMARY KEY NOT NULL,
	`routeId` text NOT NULL,
	`name` text,
	`startDistanceMeters` real NOT NULL,
	`endDistanceMeters` real NOT NULL,
	`lengthMeters` real NOT NULL,
	`totalAscentMeters` real NOT NULL,
	`startElevationMeters` real NOT NULL,
	`endElevationMeters` real NOT NULL,
	`averageGradientPercent` real NOT NULL,
	`maxGradientPercent` real NOT NULL,
	`difficultyScore` real NOT NULL,
	FOREIGN KEY (`routeId`) REFERENCES `routes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_climbs_route_distance` ON `climbs` (`routeId`,`startDistanceMeters`);
