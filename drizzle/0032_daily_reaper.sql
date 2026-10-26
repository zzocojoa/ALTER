CREATE TABLE `external_attempt_records` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`operation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`lease_id` text NOT NULL,
	`lease_epoch` integer NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`provider_request_id` text,
	`status_code` integer,
	`error` text,
	`verification` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`operation_id`) REFERENCES `external_operations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`provider_request_id`) REFERENCES `google_requests`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_attempt_record_identity" CHECK(ordinal>=1 AND lease_epoch>=1 AND length(lease_id)=36 AND mode IN ('write','verify')),
	CONSTRAINT "external_attempt_record_state" CHECK(state IN ('started','received','verified','failed','unknown','conflict','not-sent') AND ((state='started' AND finished_at IS NULL) OR (state!='started' AND finished_at IS NOT NULL AND finished_at>=started_at))),
	CONSTRAINT "external_attempt_record_evidence" CHECK(started_at>=0 AND (status_code IS NULL OR (status_code>=100 AND status_code<=599)) AND (error IS NULL OR json_valid(error)) AND (verification IS NULL OR json_valid(verification)) AND (state!='verified' OR (verification IS NOT NULL AND coalesce(json_extract(verification,'$.status'),'')='matched')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_attempt_record_order` ON `external_attempt_records` (`owner_id`,`operation_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `external_operations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`step_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`business_key` text NOT NULL,
	`snapshot` text NOT NULL,
	`request_hash` text NOT NULL,
	`expected_hash` text NOT NULL,
	`external_id` text,
	`state` text NOT NULL,
	`lease_id` text,
	`lease_epoch` integer NOT NULL,
	`lease_until` integer,
	`intent_at` integer,
	`response_at` integer,
	`attempt_count` integer NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`verification` text,
	`last_error` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`workflow_id`) REFERENCES `external_workflows`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`step_id`) REFERENCES `external_steps`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_operation_data" CHECK(version>=1 AND ordinal>=1 AND ordinal<=40 AND length(kind)>0 AND length(business_key)>0 AND length(request_hash)=64 AND length(expected_hash)=64 AND json_valid(snapshot) AND attempt_count>=0 AND lease_epoch>=0 AND next_attempt_at>=0),
	CONSTRAINT "external_operation_state" CHECK(state IN ('pending','running','received','confirmed','failed','unknown','conflict')),
	CONSTRAINT "external_operation_lease" CHECK((state='running' AND lease_id IS NOT NULL AND lease_until IS NOT NULL AND lease_epoch>=1) OR (state!='running' AND lease_id IS NULL AND lease_until IS NULL)),
	CONSTRAINT "external_operation_times" CHECK((intent_at IS NULL OR intent_at>=0) AND (response_at IS NULL OR (intent_at IS NOT NULL AND response_at>=intent_at))),
	CONSTRAINT "external_operation_evidence" CHECK((verification IS NULL OR json_valid(verification)) AND (last_error IS NULL OR json_valid(last_error)) AND (state!='received' OR response_at IS NOT NULL) AND (state!='confirmed' OR (external_id IS NOT NULL AND verification IS NOT NULL AND coalesce(json_extract(verification,'$.status'),'')='matched' AND coalesce(json_extract(verification,'$.expectedHash'),'')=expected_hash AND coalesce(json_extract(verification,'$.checkedAt'),-1)>=0)))
);
--> statement-breakpoint
CREATE INDEX `external_operation_pending` ON `external_operations` (`owner_id`,`workflow_id`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_operation_order` ON `external_operations` (`owner_id`,`workflow_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `external_request_keys` (
	`owner_id` text NOT NULL,
	`request_key` text NOT NULL,
	`workflow_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `request_key`),
	FOREIGN KEY (`owner_id`,`workflow_id`) REFERENCES `external_workflows`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_request_key_data" CHECK(length(request_key)>0 AND length(request_key)<=200 AND length(request_hash)=64 AND created_at>=0)
);
--> statement-breakpoint
CREATE TABLE `external_workflows` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_key` text NOT NULL,
	`source_version` text NOT NULL,
	`request_hash` text NOT NULL,
	`snapshot` text NOT NULL,
	`connection_id` text NOT NULL,
	`google_subject` text NOT NULL,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	`deadline_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `external_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_workflow_identity" CHECK(version>=1 AND generation>=1 AND kind IN ('weekly-export','calendar') AND length(target_key)>0 AND length(source_version)>0 AND length(google_subject)>0),
	CONSTRAINT "external_workflow_snapshot" CHECK(length(request_hash)=64 AND json_valid(snapshot) AND created_at>=0 AND deadline_at>created_at),
	CONSTRAINT "external_workflow_state" CHECK(state IN ('pending','running','partial','confirmed','failed','unknown','conflict'))
);
--> statement-breakpoint
CREATE INDEX `external_workflow_target` ON `external_workflows` (`owner_id`,`target_key`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_workflow_business_version` ON `external_workflows` (`owner_id`,`kind`,`target_key`,`source_version`);