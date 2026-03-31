// Generated from db/schema.ts — regenerate with: npm run db:migrate
// Do not edit manually.

export default {
  journal: {
    entries: [
      { idx: 0, when: 1774960304141, tag: "0000_misty_true_believers", breakpoints: true },
    ],
  },
  migrations: {
    "m0000": `CREATE TABLE \`pois\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`sourceId\` text NOT NULL,
	\`source\` text DEFAULT 'osm' NOT NULL,
	\`routeId\` text NOT NULL,
	\`name\` text,
	\`category\` text NOT NULL,
	\`latitude\` real NOT NULL,
	\`longitude\` real NOT NULL,
	\`tags\` text NOT NULL,
	\`distanceFromRouteMeters\` real NOT NULL,
	\`distanceAlongRouteMeters\` real NOT NULL,
	FOREIGN KEY (\`routeId\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`idx_pois_route_category\` ON \`pois\` (\`routeId\`,\`category\`);--> statement-breakpoint
CREATE INDEX \`idx_pois_route_along\` ON \`pois\` (\`routeId\`,\`distanceAlongRouteMeters\`);--> statement-breakpoint
CREATE INDEX \`idx_pois_route_source\` ON \`pois\` (\`routeId\`,\`source\`);--> statement-breakpoint
CREATE UNIQUE INDEX \`uq_pois_route_source\` ON \`pois\` (\`routeId\`,\`sourceId\`);--> statement-breakpoint
CREATE TABLE \`race_segments\` (
	\`raceId\` text NOT NULL,
	\`routeId\` text NOT NULL,
	\`position\` integer NOT NULL,
	\`isSelected\` integer DEFAULT true NOT NULL,
	PRIMARY KEY(\`raceId\`, \`routeId\`),
	FOREIGN KEY (\`raceId\`) REFERENCES \`races\`(\`id\`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (\`routeId\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX \`idx_race_segments_race_pos\` ON \`race_segments\` (\`raceId\`,\`position\`);--> statement-breakpoint
CREATE TABLE \`races\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`isActive\` integer DEFAULT false NOT NULL,
	\`createdAt\` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE \`route_points\` (
	\`routeId\` text NOT NULL,
	\`idx\` integer NOT NULL,
	\`latitude\` real NOT NULL,
	\`longitude\` real NOT NULL,
	\`elevationMeters\` real,
	\`distanceFromStartMeters\` real NOT NULL,
	PRIMARY KEY(\`routeId\`, \`idx\`),
	FOREIGN KEY (\`routeId\`) REFERENCES \`routes\`(\`id\`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE \`routes\` (
	\`id\` text PRIMARY KEY NOT NULL,
	\`name\` text NOT NULL,
	\`fileName\` text NOT NULL,
	\`color\` text NOT NULL,
	\`isActive\` integer DEFAULT false NOT NULL,
	\`isVisible\` integer DEFAULT true NOT NULL,
	\`totalDistanceMeters\` real NOT NULL,
	\`totalAscentMeters\` real NOT NULL,
	\`totalDescentMeters\` real NOT NULL,
	\`pointCount\` integer NOT NULL,
	\`createdAt\` text NOT NULL
);
`,
  },
};
