CREATE TABLE `google_oauth_attempts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`state_hash` text NOT NULL,
	`handle_hash` text NOT NULL,
	`nonce_hash` text NOT NULL,
	`callback_url` text NOT NULL,
	`purpose` text NOT NULL,
	`connection_id` text,
	`connection_generation` integer,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "google_oauth_hashes" CHECK(length(state_hash)=64 AND length(handle_hash)=64 AND length(nonce_hash)=64),
	CONSTRAINT "google_oauth_lifetime" CHECK(created_at>=0 AND expires_at>created_at AND expires_at-created_at<=600000 AND (consumed_at IS NULL OR (consumed_at>=created_at AND consumed_at<expires_at))),
	CONSTRAINT "google_oauth_purpose" CHECK((purpose='connect' AND connection_id IS NULL AND connection_generation IS NULL) OR (purpose='reconnect' AND length(connection_id)=36 AND connection_generation>=1))
);
--> statement-breakpoint
CREATE INDEX `google_oauth_expiry` ON `google_oauth_attempts` (`expires_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_oauth_state_unique` ON `google_oauth_attempts` (`state_hash`);