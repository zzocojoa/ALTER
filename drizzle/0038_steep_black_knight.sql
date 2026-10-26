CREATE TABLE `google_material_sources` (
	`owner_id` text NOT NULL,
	`read_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`material_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `read_id`),
	FOREIGN KEY (`owner_id`,`read_id`) REFERENCES `google_reference_reads`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`transfer_id`,`material_id`) REFERENCES `material_transfers`(`owner_id`,`id`,`material_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "google_material_source_time" CHECK(linked_at>=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_material_source_once` ON `google_material_sources` (`owner_id`,`material_id`);--> statement-breakpoint
CREATE TABLE `google_reference_reads` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`file_id` text NOT NULL,
	`state` text NOT NULL,
	`proof` text,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "google_reference_state" CHECK(generation>=1 AND state IN ('reading','verified','failed') AND ((state='reading' AND proof IS NULL AND finished_at IS NULL) OR (state='failed' AND proof IS NULL AND finished_at>=created_at) OR (state='verified' AND json_valid(proof) AND finished_at>=created_at)))
);
--> statement-breakpoint
CREATE INDEX `google_reference_owner_file` ON `google_reference_reads` (`owner_id`,`file_id`);