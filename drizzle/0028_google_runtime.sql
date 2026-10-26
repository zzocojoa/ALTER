CREATE TABLE `google_runtime` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	`google_email` text NOT NULL,
	`authorized_at` integer NOT NULL,
	`refresh_expires_at` integer,
	`refresh_lease_id` text,
	`refresh_lease_expires_at` integer,
	`storage_evidence` text,
	`provider_revocation` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "google_runtime_versions" CHECK(version>=1 AND generation>=1),
	CONSTRAINT "google_runtime_state" CHECK(state IN ('active','partial','refreshing','refresh-unknown','reconsent','disconnecting','disconnected')),
	CONSTRAINT "google_runtime_lease" CHECK((state='refreshing' AND refresh_lease_id IS NOT NULL AND refresh_lease_expires_at IS NOT NULL) OR (state!='refreshing' AND refresh_lease_id IS NULL AND refresh_lease_expires_at IS NULL)),
	CONSTRAINT "google_runtime_storage" CHECK(storage_evidence IS NULL OR json_valid(storage_evidence)),
	CONSTRAINT "google_runtime_revocation" CHECK(provider_revocation IN ('none','pending','revoked','failed','unknown'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_runtime_owner` ON `google_runtime` (`owner_id`);