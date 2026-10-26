CREATE TABLE `__next_external_jobs` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`weekly_version_id` text,
	`business_key` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`weekly_version_id`) REFERENCES `weekly_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_jobs_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "external_jobs_check_1" CHECK(kind IN ('weekly-export','calendar','ai')),
	CONSTRAINT "external_jobs_check_2" CHECK(state IN ('pending','running','partial','complete','conflict'))
);
--> statement-breakpoint
INSERT INTO `__next_external_jobs` SELECT * FROM `external_jobs`;
--> statement-breakpoint
CREATE TABLE `__next_external_steps` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`job_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	`lease_until` integer NOT NULL,
	`external_id` text,
	`evidence` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`job_id`) REFERENCES `__next_external_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_steps_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "external_steps_check_1" CHECK(ordinal >= 1),
	CONSTRAINT "external_steps_check_2" CHECK(state IN ('pending','leased','unknown','confirmed','conflict')),
	CONSTRAINT "external_steps_check_3" CHECK(state != 'confirmed' OR (external_id IS NOT NULL AND evidence IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__next_external_steps` SELECT * FROM `external_steps`;
--> statement-breakpoint
CREATE TABLE `__next_external_attempts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`step_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text NOT NULL,
	`evidence` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`step_id`) REFERENCES `__next_external_steps`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_attempts_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "external_attempts_check_1" CHECK(outcome IN ('sent','unknown','confirmed','conflict','not-sent'))
);
--> statement-breakpoint
INSERT INTO `__next_external_attempts` SELECT * FROM `external_attempts`;
--> statement-breakpoint
DROP TABLE `external_attempts`;
--> statement-breakpoint
DROP TABLE `external_steps`;
--> statement-breakpoint
DROP TABLE `external_jobs`;
--> statement-breakpoint
ALTER TABLE `__next_external_jobs` RENAME TO `external_jobs`;
--> statement-breakpoint
CREATE INDEX `external_jobs_ref_0` ON `external_jobs` (`owner_id`,`weekly_version_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_jobs_unique_0` ON `external_jobs` (`owner_id`,`kind`,`business_key`);
--> statement-breakpoint
ALTER TABLE `__next_external_steps` RENAME TO `external_steps`;
--> statement-breakpoint
CREATE INDEX `external_steps_ref_0` ON `external_steps` (`owner_id`,`job_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_steps_unique_0` ON `external_steps` (`owner_id`,`job_id`,`ordinal`);
--> statement-breakpoint
ALTER TABLE `__next_external_attempts` RENAME TO `external_attempts`;
--> statement-breakpoint
CREATE INDEX `external_attempts_ref_0` ON `external_attempts` (`owner_id`,`step_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_attempts_unique_0` ON `external_attempts` (`owner_id`,`step_id`,`ordinal`);
--> statement-breakpoint
CREATE TRIGGER weekly_job_requires_version BEFORE INSERT ON external_jobs WHEN NEW.kind = 'weekly-export' AND NEW.weekly_version_id IS NULL BEGIN SELECT RAISE(ABORT, 'invalid_export_version'); END;
--> statement-breakpoint
CREATE TABLE `ai_calls` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`step_id` text NOT NULL,
	`logical_request_key` text NOT NULL,
	`attempt_ordinal` integer NOT NULL,
	`stage` text NOT NULL,
	`response_id` text,
	`provider_request_id` text,
	`usage` text,
	`result` text,
	`failure_code` text,
	`http_status` integer,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `cost_reservations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `external_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `external_attempts`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`step_id`) REFERENCES `external_steps`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_call_stage" CHECK(stage IN ('intent','response-received','usage-stored','settled','validated','invalid','unknown')),
	CONSTRAINT "ai_call_version" CHECK(typeof(version) = 'integer' AND version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "ai_call_ordinal" CHECK(typeof(attempt_ordinal) = 'integer' AND attempt_ordinal BETWEEN 1 AND 3),
	CONSTRAINT "ai_call_usage" CHECK(usage IS NULL OR json_valid(usage)),
	CONSTRAINT "ai_call_result" CHECK(result IS NULL OR json_valid(result))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ai_call_attempt` ON `ai_calls` (`owner_id`,`logical_request_key`,`attempt_ordinal`);
--> statement-breakpoint
CREATE TRIGGER ai_call_requires_reserved_dispatch BEFORE INSERT ON ai_calls WHEN NEW.stage != 'intent' OR NOT EXISTS(SELECT 1 FROM cost_reservations r JOIN ai_cost_intents i ON i.owner_id = r.owner_id AND i.id = r.id JOIN external_jobs j ON j.owner_id = r.owner_id AND j.id = r.id JOIN external_steps s ON s.owner_id = j.owner_id AND s.job_id = j.id JOIN external_attempts a ON a.owner_id = s.owner_id AND a.step_id = s.id AND a.id = r.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.id AND r.state = 'reserved' AND j.kind = 'ai' AND s.id = NEW.step_id AND s.state = 'leased' AND a.outcome = 'sent') BEGIN SELECT RAISE(ABORT, 'invalid_ai_dispatch'); END;
