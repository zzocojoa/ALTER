CREATE TABLE `ai_budget_blocks` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`reason` text NOT NULL,
	`actual_units` integer NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`reservation_id`) REFERENCES `cost_reservations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_block_actual" CHECK(typeof(actual_units) = 'integer' AND actual_units >= 0 AND actual_units <= 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_block_reservation` ON `ai_budget_blocks` (`owner_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `ai_cost_intents` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`scope` text NOT NULL,
	`request_key` text NOT NULL,
	`request_fingerprint` text NOT NULL,
	`pricing_version_id` text NOT NULL,
	`bound` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `cost_reservations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`pricing_version_id`) REFERENCES `ai_pricing_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_cost_bound" CHECK(json_valid(bound) AND json_extract(bound,'$.requestFingerprint') = request_fingerprint AND json_extract(bound,'$.amount.pricingVersionId') = pricing_version_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_cost_intent_key` ON `ai_cost_intents` (`owner_id`,`scope`,`request_key`);--> statement-breakpoint
CREATE TABLE `ai_pricing_versions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "ai_pricing_snapshot" CHECK(json_valid(snapshot) AND json_extract(snapshot,'$.id') = id AND json_extract(snapshot,'$.model') = 'gpt-6-luna')
);
