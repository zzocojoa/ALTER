CREATE TABLE `google_picker_leases` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`role` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_picker_lifetime" CHECK(generation>=1 AND issued_at>=0 AND expires_at>issued_at AND expires_at-issued_at<=60000),
	CONSTRAINT "google_picker_state" CHECK(state IN ('active','consumed','canceled')),
	CONSTRAINT "google_picker_role" CHECK(role IN ('reference','docs-target','sheets-target'))
);
--> statement-breakpoint
CREATE TABLE `google_resources` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`external_id` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`evidence_id` text NOT NULL,
	`approved_at` integer NOT NULL,
	`metadata` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_resource_role" CHECK(role IN ('reference','docs-target','sheets-target','calendar-target')),
	CONSTRAINT "google_resource_source" CHECK(source IN ('picker','app-created') AND (role!='calendar-target' OR (source='app-created' AND external_id!='primary'))),
	CONSTRAINT "google_resource_metadata" CHECK(generation>=1 AND approved_at>=0 AND json_valid(metadata))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_resource_identity` ON `google_resources` (`owner_id`,`connection_id`,`generation`,`external_id`,`role`);