CREATE TABLE `material_files` (
	`owner_id` text NOT NULL,
	`material_id` text NOT NULL,
	`transfer_id` text NOT NULL,
	`registered_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `material_id`),
	FOREIGN KEY (`owner_id`,`material_id`) REFERENCES `materials`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`transfer_id`,`material_id`) REFERENCES `material_transfers`(`owner_id`,`id`,`material_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_file_transfer` ON `material_files` (`owner_id`,`transfer_id`);--> statement-breakpoint
CREATE TABLE `material_inventory` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`untracked_bytes` integer NOT NULL,
	`evidence` text NOT NULL,
	`blocked` integer NOT NULL,
	`checked_at` integer NOT NULL,
	`valid_until` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "material_inventory_version" CHECK(typeof(version) = 'integer' AND version >= 1),
	CONSTRAINT "material_inventory_bytes" CHECK(typeof(untracked_bytes) = 'integer' AND untracked_bytes BETWEEN 0 AND 268435456),
	CONSTRAINT "material_inventory_evidence" CHECK(json_valid(evidence) AND blocked IN (0,1) AND valid_until > checked_at)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_inventory_owner` ON `material_inventory` (`owner_id`);--> statement-breakpoint
CREATE TABLE `material_transfers` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`material_id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`metadata` text NOT NULL,
	`state` text NOT NULL,
	`write_status` text NOT NULL,
	`multipart_id` text,
	`object_version` text,
	`etag` text,
	`actual_hash` text,
	`actual_bytes` integer,
	`validation` text,
	`failure_code` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`,`material_id`) REFERENCES `uploads`(`owner_id`,`id`,`material_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_transfer_version" CHECK(typeof(version) = 'integer' AND version >= 1),
	CONSTRAINT "material_transfer_metadata" CHECK(json_valid(metadata) AND json_extract(metadata,'$.bytes') > 0),
	CONSTRAINT "material_transfer_state" CHECK(state IN ('reserved','transferring','stored','validating','verified','registered','failed','unknown','cleaning','discarded')),
	CONSTRAINT "material_transfer_write" CHECK(write_status IN ('not-started','active','succeeded','aborted','unknown')),
	CONSTRAINT "material_transfer_object" CHECK(write_status != 'succeeded' OR (object_version IS NOT NULL AND etag IS NOT NULL AND actual_hash IS NOT NULL AND actual_bytes IS NOT NULL AND actual_hash = json_extract(metadata,'$.sha256') AND actual_bytes = json_extract(metadata,'$.bytes'))),
	CONSTRAINT "material_transfer_validation" CHECK(validation IS NULL OR json_valid(validation)),
	CONSTRAINT "material_transfer_confirmed" CHECK(state NOT IN ('verified','registered') OR (write_status = 'succeeded' AND validation IS NOT NULL AND json_extract(validation,'$.objectVersion') = object_version AND json_extract(validation,'$.etag') = etag AND json_extract(validation,'$.sha256') = actual_hash AND json_extract(validation,'$.bytes') = actual_bytes)),
	CONSTRAINT "material_transfer_cleanup" CHECK(state NOT IN ('cleaning','discarded') OR write_status IN ('not-started','succeeded','aborted'))
);
--> statement-breakpoint
CREATE INDEX `material_transfer_state` ON `material_transfers` (`owner_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_transfer_reference` ON `material_transfers` (`owner_id`,`id`,`material_id`);