CREATE TABLE `google_provider_blocks` (
	`owner_id` text NOT NULL,
	`project_id` text NOT NULL,
	`api` text NOT NULL,
	`policy_version` integer NOT NULL,
	`reason` text NOT NULL,
	`status` integer NOT NULL,
	`blocked_at` integer NOT NULL,
	`blocked_until` integer,
	PRIMARY KEY(`owner_id`, `project_id`, `api`),
	CONSTRAINT "google_provider_block_data" CHECK(policy_version>=1 AND blocked_at>=0 AND (blocked_until IS NULL OR blocked_until>blocked_at) AND reason IN ('quota','storage-full','api-disabled'))
);
