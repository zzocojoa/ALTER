CREATE TABLE `answer_drafts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`text` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`attempt_id`) REFERENCES `attempts`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "answer_drafts_check_0" CHECK(version >= 1 AND version <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `answer_drafts_ref_0` ON `answer_drafts` (`owner_id`,`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `answer_drafts_unique_0` ON `answer_drafts` (`owner_id`,`attempt_id`);--> statement-breakpoint
CREATE TABLE `answers` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`text` text NOT NULL,
	`submitted_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`attempt_id`) REFERENCES `attempts`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "answers_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "answers_check_1" CHECK(length(text) > 0)
);
--> statement-breakpoint
CREATE INDEX `answers_ref_0` ON `answers` (`owner_id`,`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `answers_unique_0` ON `answers` (`owner_id`,`attempt_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `answers_unique_1` ON `answers` (`owner_id`,`id`,`attempt_id`);--> statement-breakpoint
CREATE TABLE `atomic_checks` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`request_id` text NOT NULL,
	`step` integer NOT NULL,
	`matched` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`request_id`) REFERENCES `atomic_requests`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "atomic_checks_check_0" CHECK(matched = 1)
);
--> statement-breakpoint
CREATE INDEX `atomic_checks_ref_0` ON `atomic_checks` (`owner_id`,`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `atomic_checks_unique_0` ON `atomic_checks` (`owner_id`,`request_id`,`step`);--> statement-breakpoint
CREATE TABLE `atomic_requests` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`scope` text NOT NULL,
	`request_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "atomic_requests_check_0" CHECK(length(content_hash) = 64),
	CONSTRAINT "atomic_requests_check_1" CHECK(json_valid(result_json))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `atomic_requests_unique_0` ON `atomic_requests` (`owner_id`,`scope`,`request_key`);--> statement-breakpoint
CREATE TABLE `attempts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`session_id` text NOT NULL,
	`question_id` text NOT NULL,
	`original_question_id` text,
	`mode` text NOT NULL,
	`hidden_material` integer NOT NULL,
	`status` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`question_id`,`session_id`) REFERENCES `questions`(`owner_id`,`id`,`session_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`original_question_id`) REFERENCES `questions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "attempts_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "attempts_check_1" CHECK(mode IN ('initial','new-condition','delayed-recall')),
	CONSTRAINT "attempts_check_2" CHECK((mode = 'new-condition') = (original_question_id IS NOT NULL)),
	CONSTRAINT "attempts_check_3" CHECK(original_question_id IS NULL OR original_question_id != question_id),
	CONSTRAINT "attempts_check_4" CHECK(hidden_material IN (0,1)),
	CONSTRAINT "attempts_check_5" CHECK(status IN ('awaiting-answer','awaiting-revision','ready'))
);
--> statement-breakpoint
CREATE INDEX `attempts_ref_0` ON `attempts` (`owner_id`,`question_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `attempts_ref_1` ON `attempts` (`owner_id`,`original_question_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `attempts_unique_0` ON `attempts` (`owner_id`,`id`,`session_id`);--> statement-breakpoint
CREATE TABLE `confirmed_results` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`result_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`answer_id` text NOT NULL,
	`progress` text NOT NULL,
	`performance` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`correction_id` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`result_id`) REFERENCES `learning_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "confirmed_results_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "confirmed_results_check_1" CHECK(progress IN ('미시작','진행 중','완료')),
	CONSTRAINT "confirmed_results_check_2" CHECK(performance IN ('미확인','설명 필요','도움받아 수행','독립 수행','지연 재현'))
);
--> statement-breakpoint
CREATE INDEX `confirmed_results_ref_0` ON `confirmed_results` (`owner_id`,`result_id`);--> statement-breakpoint
CREATE INDEX `confirmed_results_ref_1` ON `confirmed_results` (`owner_id`,`answer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `confirmed_results_unique_0` ON `confirmed_results` (`owner_id`,`result_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `conversations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "conversations_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "conversations_check_1" CHECK(role IN ('learner','coach','system'))
);
--> statement-breakpoint
CREATE INDEX `conversations_ref_0` ON `conversations` (`owner_id`,`session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `conversations_unique_0` ON `conversations` (`owner_id`,`session_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `correction_impacts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`correction_id` text NOT NULL,
	`review_id` text NOT NULL,
	`old_version` integer NOT NULL,
	`new_version` integer NOT NULL,
	`old_question` text NOT NULL,
	`old_explanation` text NOT NULL,
	`old_next_action` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`correction_id`) REFERENCES `corrections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`review_id`) REFERENCES `review_items`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "correction_impacts_check_0" CHECK(new_version = old_version + 1)
);
--> statement-breakpoint
CREATE INDEX `correction_impacts_ref_0` ON `correction_impacts` (`owner_id`,`correction_id`);--> statement-breakpoint
CREATE INDEX `correction_impacts_ref_1` ON `correction_impacts` (`owner_id`,`review_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `correction_impacts_unique_0` ON `correction_impacts` (`owner_id`,`correction_id`,`review_id`);--> statement-breakpoint
CREATE TABLE `corrections` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`error_id` text NOT NULL,
	`concept` text NOT NULL,
	`source_ref_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`study_date` text NOT NULL,
	`reason` text NOT NULL,
	`evidence` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`error_id`) REFERENCES `errors`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`source_ref_id`) REFERENCES `source_references`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "corrections_check_0" CHECK(length(trim(reason)) > 0),
	CONSTRAINT "corrections_check_1" CHECK(length(trim(evidence)) > 0)
);
--> statement-breakpoint
CREATE INDEX `corrections_ref_0` ON `corrections` (`owner_id`,`error_id`);--> statement-breakpoint
CREATE INDEX `corrections_ref_1` ON `corrections` (`owner_id`,`source_ref_id`);--> statement-breakpoint
CREATE INDEX `corrections_ref_2` ON `corrections` (`owner_id`,`answer_id`);--> statement-breakpoint
CREATE TABLE `cost_reservations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`window_id` text NOT NULL,
	`request_business_key` text NOT NULL,
	`model` text NOT NULL,
	`amount_units` integer NOT NULL,
	`state` text NOT NULL,
	`actual_units` integer,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`window_id`) REFERENCES `cost_windows`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_reservations_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "cost_reservations_check_1" CHECK(amount_units >= 0 AND amount_units <= 9007199254740991),
	CONSTRAINT "cost_reservations_check_2" CHECK(actual_units IS NULL OR (actual_units >= 0 AND actual_units <= amount_units)),
	CONSTRAINT "cost_reservations_check_3" CHECK(state IN ('reserved','settled','released','unknown')),
	CONSTRAINT "cost_reservations_check_4" CHECK(model = 'gpt-6-luna' OR model = 'operations')
);
--> statement-breakpoint
CREATE INDEX `cost_reservations_ref_0` ON `cost_reservations` (`owner_id`,`window_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_reservations_unique_0` ON `cost_reservations` (`owner_id`,`window_id`,`request_business_key`);--> statement-breakpoint
CREATE TABLE `cost_usage` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`actual_units` integer NOT NULL,
	`provider_receipt` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`request_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`reservation_id`) REFERENCES `cost_reservations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cost_usage_check_0" CHECK(actual_units >= 0)
);
--> statement-breakpoint
CREATE INDEX `cost_usage_ref_0` ON `cost_usage` (`owner_id`,`reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `cost_usage_unique_0` ON `cost_usage` (`owner_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `cost_windows` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`category` text NOT NULL,
	`period_start` integer NOT NULL,
	`reset_at` integer NOT NULL,
	`currency` text NOT NULL,
	`scale` integer NOT NULL,
	`limit_units` integer NOT NULL,
	`reserved_units` integer NOT NULL,
	`settled_units` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "cost_windows_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "cost_windows_check_1" CHECK(category IN ('ai','operations')),
	CONSTRAINT "cost_windows_check_2" CHECK(currency = 'KRW'),
	CONSTRAINT "cost_windows_check_3" CHECK(scale = 1000000),
	CONSTRAINT "cost_windows_check_4" CHECK(period_start < reset_at),
	CONSTRAINT "cost_windows_check_5" CHECK(reserved_units >= 0),
	CONSTRAINT "cost_windows_check_6" CHECK(settled_units >= 0),
	CONSTRAINT "cost_windows_check_7" CHECK(limit_units >= 0 AND limit_units <= 9007199254740991),
	CONSTRAINT "cost_windows_check_8" CHECK(reserved_units <= limit_units - settled_units),
	CONSTRAINT "cost_windows_check_9" CHECK((category = 'ai' AND limit_units <= 7000000000) OR (category = 'operations' AND limit_units <= 10000000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cost_windows_unique_0` ON `cost_windows` (`owner_id`,`category`,`period_start`,`reset_at`);--> statement-breakpoint
CREATE TABLE `courses` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "courses_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "courses_check_1" CHECK(length(title) > 0)
);
--> statement-breakpoint
CREATE TABLE `errors` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`concept` text NOT NULL,
	`description` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`unit_id`) REFERENCES `units`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "errors_check_0" CHECK(version >= 1 AND version <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `errors_ref_0` ON `errors` (`owner_id`,`unit_id`);--> statement-breakpoint
CREATE INDEX `errors_ref_1` ON `errors` (`owner_id`,`answer_id`);--> statement-breakpoint
CREATE TABLE `external_attempts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`step_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`outcome` text NOT NULL,
	`evidence` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`step_id`) REFERENCES `external_steps`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_attempts_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "external_attempts_check_1" CHECK(outcome IN ('sent','unknown','confirmed','conflict','not-sent'))
);
--> statement-breakpoint
CREATE INDEX `external_attempts_ref_0` ON `external_attempts` (`owner_id`,`step_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_attempts_unique_0` ON `external_attempts` (`owner_id`,`step_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `external_jobs` (
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
	CONSTRAINT "external_jobs_check_1" CHECK(kind IN ('weekly-export','calendar')),
	CONSTRAINT "external_jobs_check_2" CHECK(state IN ('pending','running','partial','complete','conflict'))
);
--> statement-breakpoint
CREATE INDEX `external_jobs_ref_0` ON `external_jobs` (`owner_id`,`weekly_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_jobs_unique_0` ON `external_jobs` (`owner_id`,`kind`,`business_key`);--> statement-breakpoint
CREATE TABLE `external_steps` (
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
	FOREIGN KEY (`owner_id`,`job_id`) REFERENCES `external_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_steps_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "external_steps_check_1" CHECK(ordinal >= 1),
	CONSTRAINT "external_steps_check_2" CHECK(state IN ('pending','leased','unknown','confirmed','conflict')),
	CONSTRAINT "external_steps_check_3" CHECK(state != 'confirmed' OR (external_id IS NOT NULL AND evidence IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `external_steps_ref_0` ON `external_steps` (`owner_id`,`job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `external_steps_unique_0` ON `external_steps` (`owner_id`,`job_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `feedback` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`answer_id` text NOT NULL,
	`position` integer NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "feedback_check_0" CHECK(position BETWEEN 1 AND 2),
	CONSTRAINT "feedback_check_1" CHECK(length(content) > 0)
);
--> statement-breakpoint
CREATE INDEX `feedback_ref_0` ON `feedback` (`owner_id`,`answer_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `feedback_unique_0` ON `feedback` (`owner_id`,`answer_id`,`position`);--> statement-breakpoint
CREATE TABLE `google_connections` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`google_subject` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`reconnect_required` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "google_connections_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "google_connections_check_1" CHECK(json_valid(scopes)),
	CONSTRAINT "google_connections_check_2" CHECK(reconnect_required IN (0,1))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `google_connections_unique_0` ON `google_connections` (`owner_id`,`google_subject`);--> statement-breakpoint
CREATE TABLE `google_tokens` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`algorithm` text NOT NULL,
	`ciphertext` text NOT NULL,
	`nonce` text NOT NULL,
	`key_version` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "google_tokens_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "google_tokens_check_1" CHECK(algorithm = 'AES-GCM'),
	CONSTRAINT "google_tokens_check_2" CHECK(length(ciphertext) >= 24),
	CONSTRAINT "google_tokens_check_3" CHECK(length(nonce) = 16)
);
--> statement-breakpoint
CREATE INDEX `google_tokens_ref_0` ON `google_tokens` (`owner_id`,`connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `google_tokens_unique_0` ON `google_tokens` (`owner_id`,`connection_id`);--> statement-breakpoint
CREATE TABLE `help_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`kind` text NOT NULL,
	`level` integer NOT NULL,
	`shown_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`attempt_id`) REFERENCES `attempts`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "help_events_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "help_events_check_1" CHECK(level BETWEEN 1 AND 3),
	CONSTRAINT "help_events_check_2" CHECK(kind IN ('hint','answer','explanation'))
);
--> statement-breakpoint
CREATE INDEX `help_events_ref_0` ON `help_events` (`owner_id`,`attempt_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `help_events_unique_0` ON `help_events` (`owner_id`,`attempt_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `learning_results` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`current_version_id` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`unit_id`) REFERENCES `units`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "learning_results_check_0" CHECK(version >= 1 AND version <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `learning_results_ref_0` ON `learning_results` (`owner_id`,`unit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `learning_results_unique_0` ON `learning_results` (`owner_id`,`unit_id`);--> statement-breakpoint
CREATE TABLE `material_pages` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`material_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`file_page` integer NOT NULL,
	`printed_page` text,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`upload_id`,`material_id`) REFERENCES `uploads`(`owner_id`,`id`,`material_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "material_pages_check_0" CHECK(file_page >= 1)
);
--> statement-breakpoint
CREATE INDEX `material_pages_ref_0` ON `material_pages` (`owner_id`,`upload_id`,`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_pages_unique_0` ON `material_pages` (`owner_id`,`upload_id`,`file_page`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_pages_unique_1` ON `material_pages` (`owner_id`,`id`,`material_id`,`upload_id`,`file_page`);--> statement-breakpoint
CREATE TABLE `materials` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	`origin` text NOT NULL,
	`original_id` text,
	`modified_at` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`course_id`) REFERENCES `courses`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "materials_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "materials_check_1" CHECK(origin IN ('upload','google')),
	CONSTRAINT "materials_check_2" CHECK(origin != 'google' OR (original_id IS NOT NULL AND modified_at IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `materials_ref_0` ON `materials` (`owner_id`,`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `materials_unique_0` ON `materials` (`owner_id`,`id`,`course_id`);--> statement-breakpoint
CREATE TABLE `plan_drafts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`plan_id` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`plan_id`) REFERENCES `plans`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plan_drafts_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "plan_drafts_check_1" CHECK(json_valid(content))
);
--> statement-breakpoint
CREATE INDEX `plan_drafts_ref_0` ON `plan_drafts` (`owner_id`,`plan_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_drafts_unique_0` ON `plan_drafts` (`owner_id`,`plan_id`);--> statement-breakpoint
CREATE TABLE `plan_versions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`plan_id` text NOT NULL,
	`course_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`content` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`plan_id`,`course_id`) REFERENCES `plans`(`owner_id`,`id`,`course_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plan_versions_check_0" CHECK(ordinal >= 1),
	CONSTRAINT "plan_versions_check_1" CHECK(json_valid(content))
);
--> statement-breakpoint
CREATE INDEX `plan_versions_ref_0` ON `plan_versions` (`owner_id`,`plan_id`,`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_unique_0` ON `plan_versions` (`owner_id`,`plan_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `plan_versions_unique_1` ON `plan_versions` (`owner_id`,`id`,`course_id`);--> statement-breakpoint
CREATE TABLE `plans` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`course_id` text NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`course_id`) REFERENCES `courses`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "plans_check_0" CHECK(version >= 1 AND version <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `plans_ref_0` ON `plans` (`owner_id`,`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `plans_unique_0` ON `plans` (`owner_id`,`id`,`course_id`);--> statement-breakpoint
CREATE TABLE `questions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`source_ref_id` text,
	`prompt` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`source_ref_id`) REFERENCES `source_references`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "questions_check_0" CHECK(length(prompt) > 0)
);
--> statement-breakpoint
CREATE INDEX `questions_ref_0` ON `questions` (`owner_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `questions_ref_1` ON `questions` (`owner_id`,`source_ref_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `questions_unique_0` ON `questions` (`owner_id`,`id`,`session_id`);--> statement-breakpoint
CREATE TABLE `quota_reservations` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`window_id` text NOT NULL,
	`business_key` text NOT NULL,
	`method` text NOT NULL,
	`weight` integer NOT NULL,
	`state` text NOT NULL,
	`actual_units` integer,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`window_id`) REFERENCES `quota_windows`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quota_reservations_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "quota_reservations_check_1" CHECK(weight > 0 AND weight <= 9007199254740991),
	CONSTRAINT "quota_reservations_check_2" CHECK(actual_units IS NULL OR (actual_units >= 0 AND actual_units <= weight)),
	CONSTRAINT "quota_reservations_check_3" CHECK(state IN ('reserved','settled','released','unknown'))
);
--> statement-breakpoint
CREATE INDEX `quota_reservations_ref_0` ON `quota_reservations` (`owner_id`,`window_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_reservations_unique_0` ON `quota_reservations` (`owner_id`,`window_id`,`business_key`);--> statement-breakpoint
CREATE TABLE `quota_usage` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`actual_units` integer NOT NULL,
	`provider_receipt` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`request_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`reservation_id`) REFERENCES `quota_reservations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "quota_usage_check_0" CHECK(actual_units >= 0)
);
--> statement-breakpoint
CREATE INDEX `quota_usage_ref_0` ON `quota_usage` (`owner_id`,`reservation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `quota_usage_unique_0` ON `quota_usage` (`owner_id`,`reservation_id`);--> statement-breakpoint
CREATE TABLE `quota_windows` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`api` text NOT NULL,
	`project_key` text NOT NULL,
	`provider_user` text NOT NULL,
	`quota_unit` text NOT NULL,
	`period_start` integer NOT NULL,
	`reset_at` integer NOT NULL,
	`limit_units` integer NOT NULL,
	`reserved_units` integer NOT NULL,
	`settled_units` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "quota_windows_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "quota_windows_check_1" CHECK(period_start < reset_at),
	CONSTRAINT "quota_windows_check_2" CHECK(limit_units BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "quota_windows_check_3" CHECK(reserved_units >= 0),
	CONSTRAINT "quota_windows_check_4" CHECK(settled_units >= 0),
	CONSTRAINT "quota_windows_check_5" CHECK(reserved_units <= limit_units - settled_units)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quota_windows_unique_0` ON `quota_windows` (`owner_id`,`api`,`project_key`,`provider_user`,`quota_unit`,`period_start`,`reset_at`);--> statement-breakpoint
CREATE TABLE `reference_selections` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`material_id` text NOT NULL,
	`external_id` text NOT NULL,
	`modified_at` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`material_id`) REFERENCES `materials`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `reference_selections_ref_0` ON `reference_selections` (`owner_id`,`connection_id`);--> statement-breakpoint
CREATE INDEX `reference_selections_ref_1` ON `reference_selections` (`owner_id`,`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `reference_selections_unique_0` ON `reference_selections` (`owner_id`,`connection_id`,`external_id`);--> statement-breakpoint
CREATE TABLE `review_attempts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`review_id` text NOT NULL,
	`correction_id` text,
	`answer_id` text NOT NULL,
	`kind` text NOT NULL,
	`performed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`review_id`) REFERENCES `review_items`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`correction_id`) REFERENCES `corrections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_attempts_check_0" CHECK(kind IN ('variable','delayed-recall'))
);
--> statement-breakpoint
CREATE INDEX `review_attempts_ref_0` ON `review_attempts` (`owner_id`,`review_id`);--> statement-breakpoint
CREATE INDEX `review_attempts_ref_1` ON `review_attempts` (`owner_id`,`correction_id`);--> statement-breakpoint
CREATE INDEX `review_attempts_ref_2` ON `review_attempts` (`owner_id`,`answer_id`);--> statement-breakpoint
CREATE TABLE `review_items` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`error_id` text NOT NULL,
	`source_ref_id` text NOT NULL,
	`question` text NOT NULL,
	`explanation` text NOT NULL,
	`next_action` text NOT NULL,
	`correction_id` text,
	`recheck_state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`error_id`) REFERENCES `errors`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`source_ref_id`) REFERENCES `source_references`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_items_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "review_items_check_1" CHECK(recheck_state IN ('required','independent','delayed'))
);
--> statement-breakpoint
CREATE INDEX `review_items_ref_0` ON `review_items` (`owner_id`,`error_id`);--> statement-breakpoint
CREATE INDEX `review_items_ref_1` ON `review_items` (`owner_id`,`source_ref_id`);--> statement-breakpoint
CREATE TABLE `revisions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`answer_id` text NOT NULL,
	`feedback_id` text NOT NULL,
	`text` text NOT NULL,
	`reason` text NOT NULL,
	`submitted_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`feedback_id`) REFERENCES `feedback`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "revisions_check_0" CHECK(length(text) > 0),
	CONSTRAINT "revisions_check_1" CHECK(length(trim(reason)) > 0)
);
--> statement-breakpoint
CREATE INDEX `revisions_ref_0` ON `revisions` (`owner_id`,`answer_id`);--> statement-breakpoint
CREATE INDEX `revisions_ref_1` ON `revisions` (`owner_id`,`feedback_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `revisions_unique_0` ON `revisions` (`owner_id`,`feedback_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`course_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`study_date` text NOT NULL,
	`status` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`unit_id`,`course_id`) REFERENCES `units`(`owner_id`,`id`,`course_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`plan_version_id`,`course_id`) REFERENCES `plan_versions`(`owner_id`,`id`,`course_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "sessions_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "sessions_check_1" CHECK(status IN ('active','paused','finished')),
	CONSTRAINT "sessions_check_2" CHECK(length(study_date) = 10)
);
--> statement-breakpoint
CREATE INDEX `sessions_ref_0` ON `sessions` (`owner_id`,`unit_id`,`course_id`);--> statement-breakpoint
CREATE INDEX `sessions_ref_1` ON `sessions` (`owner_id`,`plan_version_id`,`course_id`);--> statement-breakpoint
CREATE TABLE `source_references` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`material_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`page_id` text NOT NULL,
	`file_page` integer NOT NULL,
	`printed_page` text,
	`span_start` integer NOT NULL,
	`span_end` integer NOT NULL,
	`evidence` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`page_id`,`material_id`,`upload_id`,`file_page`) REFERENCES `material_pages`(`owner_id`,`id`,`material_id`,`upload_id`,`file_page`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "source_references_check_0" CHECK(span_start >= 0),
	CONSTRAINT "source_references_check_1" CHECK(span_end > span_start),
	CONSTRAINT "source_references_check_2" CHECK(length(evidence) > 0)
);
--> statement-breakpoint
CREATE INDEX `source_references_ref_0` ON `source_references` (`owner_id`,`page_id`,`material_id`,`upload_id`,`file_page`);--> statement-breakpoint
CREATE TABLE `units` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`course_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`title` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`course_id`) REFERENCES `courses`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "units_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "units_check_1" CHECK(ordinal >= 1),
	CONSTRAINT "units_check_2" CHECK(length(title) > 0)
);
--> statement-breakpoint
CREATE INDEX `units_ref_0` ON `units` (`owner_id`,`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `units_unique_0` ON `units` (`owner_id`,`course_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `units_unique_1` ON `units` (`owner_id`,`id`,`course_id`);--> statement-breakpoint
CREATE TABLE `uploads` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`material_id` text NOT NULL,
	`object_key` text NOT NULL,
	`upload_id` text NOT NULL,
	`state` text NOT NULL,
	`expected_hash` text NOT NULL,
	`verified_hash` text,
	`bytes` integer NOT NULL,
	`recovery_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`material_id`) REFERENCES `materials`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "uploads_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "uploads_check_1" CHECK(state IN ('reserved','object-written','verified','unknown','missing','quarantined')),
	CONSTRAINT "uploads_check_2" CHECK(state != 'verified' OR verified_hash = expected_hash),
	CONSTRAINT "uploads_check_3" CHECK(bytes >= 0),
	CONSTRAINT "uploads_check_4" CHECK(length(expected_hash) = 64)
);
--> statement-breakpoint
CREATE INDEX `uploads_ref_0` ON `uploads` (`owner_id`,`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_unique_0` ON `uploads` (`owner_id`,`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_unique_1` ON `uploads` (`owner_id`,`upload_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uploads_unique_2` ON `uploads` (`owner_id`,`id`,`material_id`);--> statement-breakpoint
CREATE TABLE `verification_runs` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "verification_runs_check_0" CHECK(owner_id = 'verification:' || id),
	CONSTRAINT "verification_runs_check_1" CHECK(state IN ('running','cleaning'))
);
--> statement-breakpoint
CREATE TABLE `weekly_drafts` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`summary_id` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`summary_id`) REFERENCES `weekly_summaries`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "weekly_drafts_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "weekly_drafts_check_1" CHECK(json_valid(content))
);
--> statement-breakpoint
CREATE INDEX `weekly_drafts_ref_0` ON `weekly_drafts` (`owner_id`,`summary_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_drafts_unique_0` ON `weekly_drafts` (`owner_id`,`summary_id`);--> statement-breakpoint
CREATE TABLE `weekly_evidence` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`weekly_version_id` text NOT NULL,
	`result_version_id` text NOT NULL,
	`correction_id` text,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`weekly_version_id`) REFERENCES `weekly_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`result_version_id`) REFERENCES `confirmed_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`correction_id`) REFERENCES `corrections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `weekly_evidence_ref_0` ON `weekly_evidence` (`owner_id`,`weekly_version_id`);--> statement-breakpoint
CREATE INDEX `weekly_evidence_ref_1` ON `weekly_evidence` (`owner_id`,`result_version_id`);--> statement-breakpoint
CREATE INDEX `weekly_evidence_ref_2` ON `weekly_evidence` (`owner_id`,`correction_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_evidence_unique_0` ON `weekly_evidence` (`owner_id`,`weekly_version_id`,`result_version_id`);--> statement-breakpoint
CREATE TABLE `weekly_summaries` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`period_start` text NOT NULL,
	`period_end` text NOT NULL,
	`course_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`course_id`) REFERENCES `courses`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "weekly_summaries_check_0" CHECK(version >= 1 AND version <= 9007199254740991),
	CONSTRAINT "weekly_summaries_check_1" CHECK(period_start <= period_end)
);
--> statement-breakpoint
CREATE INDEX `weekly_summaries_ref_0` ON `weekly_summaries` (`owner_id`,`course_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_summaries_unique_0` ON `weekly_summaries` (`owner_id`,`course_id`,`period_start`,`period_end`);--> statement-breakpoint
CREATE TABLE `weekly_versions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`summary_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`plan_version_id` text NOT NULL,
	`achievements` text NOT NULL,
	`difficulties` text NOT NULL,
	`improvements` text NOT NULL,
	`next_actions` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`summary_id`) REFERENCES `weekly_summaries`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`plan_version_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "weekly_versions_check_0" CHECK(ordinal >= 1)
);
--> statement-breakpoint
CREATE INDEX `weekly_versions_ref_0` ON `weekly_versions` (`owner_id`,`summary_id`);--> statement-breakpoint
CREATE INDEX `weekly_versions_ref_1` ON `weekly_versions` (`owner_id`,`plan_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `weekly_versions_unique_0` ON `weekly_versions` (`owner_id`,`summary_id`,`ordinal`);--> statement-breakpoint
CREATE TABLE `write_targets` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`connection_id` text NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`app_created` integer NOT NULL,
	`approved_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`connection_id`) REFERENCES `google_connections`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "write_targets_check_0" CHECK(app_created IN (0,1)),
	CONSTRAINT "write_targets_check_1" CHECK(kind IN ('docs','sheets','calendar')),
	CONSTRAINT "write_targets_check_2" CHECK(kind != 'calendar' OR app_created = 1)
);
--> statement-breakpoint
CREATE INDEX `write_targets_ref_0` ON `write_targets` (`owner_id`,`connection_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `write_targets_unique_0` ON `write_targets` (`owner_id`,`connection_id`,`external_id`,`kind`);