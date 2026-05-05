CREATE TABLE `starred_items` (
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`createdAt` text NOT NULL,
	PRIMARY KEY(`entityType`, `entityId`)
);
