CREATE TABLE `google_report_folders` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`external_id` text NOT NULL,
	`approved_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `google_requests`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "google_report_folder_identity_check" CHECK(generation>=1 AND length(external_id)>0 AND approved_at>=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_report_folder_identity` ON `google_report_folders` (`owner_id`,`connection_id`,`generation`,`external_id`);--> statement-breakpoint
CREATE TABLE `google_report_setups` (
	`owner_id` text NOT NULL,
	`google_subject` text NOT NULL,
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `google_subject`),
	FOREIGN KEY (`owner_id`,`job_id`) REFERENCES `external_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "google_report_setup_identity" CHECK(length(google_subject)>0 AND length(id)=36 AND created_at>=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_report_setup_job` ON `google_report_setups` (`owner_id`,`job_id`);