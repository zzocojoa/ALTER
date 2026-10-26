CREATE TABLE `google_quota_charges` (
	`owner_id` text NOT NULL,
	`request_id` text NOT NULL,
	`project_id` text NOT NULL,
	`dimension_key` text NOT NULL,
	`subject` text NOT NULL,
	`weight` integer NOT NULL,
	`reserved_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `request_id`, `dimension_key`, `subject`),
	FOREIGN KEY (`owner_id`,`request_id`) REFERENCES `google_requests`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_charge_units" CHECK(weight>0 AND weight<=1000000000000 AND reserved_at>=0)
);
--> statement-breakpoint
CREATE INDEX `google_charge_window` ON `google_quota_charges` (`owner_id`,`project_id`,`dimension_key`,`subject`,`reserved_at`);--> statement-breakpoint
CREATE TABLE `google_quota_policies` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`version` integer NOT NULL,
	`hash` text NOT NULL,
	`snapshot` text NOT NULL,
	PRIMARY KEY(`owner_id`, `project_id`),
	CONSTRAINT "google_quota_policy_data" CHECK(version>=1 AND length(hash)=64 AND json_valid(snapshot))
);
--> statement-breakpoint
CREATE TABLE `google_requests` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`project_id` text NOT NULL,
	`google_subject` text NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`policy_version` integer NOT NULL,
	`method` text NOT NULL,
	`request_hash` text NOT NULL,
	`state` text NOT NULL,
	`reserved_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`sent_at` integer,
	`finished_at` integer,
	`storage_bytes` integer NOT NULL,
	`status` integer,
	`error_code` text,
	`result_external_id` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_request_state" CHECK(state IN ('reserved','sending','succeeded','failed','unknown')),
	CONSTRAINT "google_request_data" CHECK(generation>=1 AND policy_version>=1 AND length(request_hash)=64 AND reserved_at>=0 AND expires_at>reserved_at AND storage_bytes>=0 AND storage_bytes<=10485760)
);
--> statement-breakpoint
CREATE INDEX `google_request_storage` ON `google_requests` (`owner_id`,`project_id`,`google_subject`,`reserved_at`);