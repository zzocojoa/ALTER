CREATE TABLE `backup_completions` (
	`owner_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`sha256` text NOT NULL,
	PRIMARY KEY(`owner_id`, `backup_id`),
	FOREIGN KEY (`owner_id`,`backup_id`) REFERENCES `backup_runs`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backup_completion_values" CHECK("backup_completions"."completed_at">=0 AND length("backup_completions"."sha256")=64)
);
--> statement-breakpoint
CREATE TABLE `backup_objects` (
	`owner_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`material_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`object_key` text NOT NULL,
	`bytes` integer NOT NULL,
	`object_version` text NOT NULL,
	`etag` text NOT NULL,
	`sha256` text NOT NULL,
	`verified_at` integer NOT NULL,
	`acknowledged_at` integer,
	PRIMARY KEY(`owner_id`, `backup_id`, `ordinal`),
	FOREIGN KEY (`owner_id`,`backup_id`) REFERENCES `backup_runs`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backup_object_values" CHECK("backup_objects"."ordinal" BETWEEN 0 AND 9999 AND "backup_objects"."bytes" BETWEEN 1 AND 268435456 AND length("backup_objects"."sha256")=64 AND "backup_objects"."verified_at">=0 AND ("backup_objects"."acknowledged_at" IS NULL OR "backup_objects"."acknowledged_at">="backup_objects"."verified_at"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_object_upload` ON `backup_objects` (`owner_id`,`backup_id`,`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `backup_object_key` ON `backup_objects` (`owner_id`,`backup_id`,`object_key`);--> statement-breakpoint
ALTER TABLE `backup_pages` ADD `acknowledged_at` integer;