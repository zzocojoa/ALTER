CREATE TABLE `backup_checks` (
	`id` text PRIMARY KEY NOT NULL,
	`matched` integer NOT NULL,
	CONSTRAINT "backup_snapshot_matched" CHECK("backup_checks"."matched" = 1)
);
--> statement-breakpoint
CREATE TABLE `backup_pages` (
	`owner_id` text NOT NULL,
	`backup_id` text NOT NULL,
	`table_name` text NOT NULL,
	`ordinal` integer NOT NULL,
	`cursor_before` integer NOT NULL,
	`cursor_after` integer NOT NULL,
	`row_count` integer NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`final` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `backup_id`, `table_name`, `ordinal`),
	FOREIGN KEY (`owner_id`,`backup_id`) REFERENCES `backup_runs`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backup_page_bounds" CHECK("backup_pages"."ordinal" BETWEEN 0 AND 9999 AND "backup_pages"."cursor_before" >= 0 AND "backup_pages"."cursor_after" >= "backup_pages"."cursor_before" AND "backup_pages"."row_count" BETWEEN 0 AND 32 AND "backup_pages"."bytes" BETWEEN 1 AND 4194304 AND length("backup_pages"."sha256") = 64 AND "backup_pages"."final" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `backup_revisions` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	CONSTRAINT "backup_revision_safe" CHECK("backup_revisions"."revision" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE `backup_runs` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`source_project_id` text NOT NULL,
	`catalog_hash` text NOT NULL,
	`revision` integer NOT NULL,
	`started_at` integer NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`) REFERENCES `backup_revisions`(`owner_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "backup_run_state" CHECK("backup_runs"."state" IN ('exporting','database-ready','complete','cancelled')),
	CONSTRAINT "backup_run_values" CHECK("backup_runs"."revision" BETWEEN 0 AND 9007199254740991 AND "backup_runs"."started_at" >= 0 AND length("backup_runs"."catalog_hash") = 64)
);

--> statement-breakpoint
CREATE TRIGGER backup_advisor_events_insert AFTER INSERT ON "advisor_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_advisor_events_delete AFTER DELETE ON "advisor_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_advisor_events_update AFTER UPDATE ON "advisor_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_advisor_sessions_insert AFTER INSERT ON "advisor_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_advisor_sessions_delete AFTER DELETE ON "advisor_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_advisor_sessions_update AFTER UPDATE ON "advisor_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_budget_blocks_insert AFTER INSERT ON "ai_budget_blocks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_budget_blocks_delete AFTER DELETE ON "ai_budget_blocks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_budget_blocks_update AFTER UPDATE ON "ai_budget_blocks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_calls_insert AFTER INSERT ON "ai_calls" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_calls_delete AFTER DELETE ON "ai_calls" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_calls_update AFTER UPDATE ON "ai_calls" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_cost_intents_insert AFTER INSERT ON "ai_cost_intents" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_cost_intents_delete AFTER DELETE ON "ai_cost_intents" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_cost_intents_update AFTER UPDATE ON "ai_cost_intents" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_funding_checks_insert AFTER INSERT ON "ai_funding_checks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_funding_checks_delete AFTER DELETE ON "ai_funding_checks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_funding_checks_update AFTER UPDATE ON "ai_funding_checks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_pricing_versions_insert AFTER INSERT ON "ai_pricing_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_pricing_versions_delete AFTER DELETE ON "ai_pricing_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_ai_pricing_versions_update AFTER UPDATE ON "ai_pricing_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answer_drafts_insert AFTER INSERT ON "answer_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answer_drafts_delete AFTER DELETE ON "answer_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answer_drafts_update AFTER UPDATE ON "answer_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answer_files_insert AFTER INSERT ON "answer_files" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answer_files_delete AFTER DELETE ON "answer_files" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answer_files_update AFTER UPDATE ON "answer_files" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answers_insert AFTER INSERT ON "answers" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answers_delete AFTER DELETE ON "answers" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_answers_update AFTER UPDATE ON "answers" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_atomic_checks_insert AFTER INSERT ON "atomic_checks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_atomic_checks_delete AFTER DELETE ON "atomic_checks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_atomic_checks_update AFTER UPDATE ON "atomic_checks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_atomic_requests_insert AFTER INSERT ON "atomic_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_atomic_requests_delete AFTER DELETE ON "atomic_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_atomic_requests_update AFTER UPDATE ON "atomic_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_attempts_insert AFTER INSERT ON "attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_attempts_delete AFTER DELETE ON "attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_attempts_update AFTER UPDATE ON "attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_confirmed_results_insert AFTER INSERT ON "confirmed_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_confirmed_results_delete AFTER DELETE ON "confirmed_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_confirmed_results_update AFTER UPDATE ON "confirmed_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_conversations_insert AFTER INSERT ON "conversations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_conversations_delete AFTER DELETE ON "conversations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_conversations_update AFTER UPDATE ON "conversations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_correction_impacts_insert AFTER INSERT ON "correction_impacts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_correction_impacts_delete AFTER DELETE ON "correction_impacts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_correction_impacts_update AFTER UPDATE ON "correction_impacts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_corrections_insert AFTER INSERT ON "corrections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_corrections_delete AFTER DELETE ON "corrections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_corrections_update AFTER UPDATE ON "corrections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_reservations_insert AFTER INSERT ON "cost_reservations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_reservations_delete AFTER DELETE ON "cost_reservations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_reservations_update AFTER UPDATE ON "cost_reservations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_usage_insert AFTER INSERT ON "cost_usage" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_usage_delete AFTER DELETE ON "cost_usage" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_usage_update AFTER UPDATE ON "cost_usage" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_windows_insert AFTER INSERT ON "cost_windows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_windows_delete AFTER DELETE ON "cost_windows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_cost_windows_update AFTER UPDATE ON "cost_windows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_courses_insert AFTER INSERT ON "courses" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_courses_delete AFTER DELETE ON "courses" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_courses_update AFTER UPDATE ON "courses" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_errors_insert AFTER INSERT ON "errors" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_errors_delete AFTER DELETE ON "errors" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_errors_update AFTER UPDATE ON "errors" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_attempt_records_insert AFTER INSERT ON "external_attempt_records" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_attempt_records_delete AFTER DELETE ON "external_attempt_records" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_attempt_records_update AFTER UPDATE ON "external_attempt_records" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_attempts_insert AFTER INSERT ON "external_attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_attempts_delete AFTER DELETE ON "external_attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_attempts_update AFTER UPDATE ON "external_attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_google_requests_insert AFTER INSERT ON "external_google_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_google_requests_delete AFTER DELETE ON "external_google_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_google_requests_update AFTER UPDATE ON "external_google_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_jobs_insert AFTER INSERT ON "external_jobs" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_jobs_delete AFTER DELETE ON "external_jobs" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_jobs_update AFTER UPDATE ON "external_jobs" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_operations_insert AFTER INSERT ON "external_operations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_operations_delete AFTER DELETE ON "external_operations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_operations_update AFTER UPDATE ON "external_operations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_request_keys_insert AFTER INSERT ON "external_request_keys" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_request_keys_delete AFTER DELETE ON "external_request_keys" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_request_keys_update AFTER UPDATE ON "external_request_keys" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_sheet_locks_insert AFTER INSERT ON "external_sheet_locks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_sheet_locks_delete AFTER DELETE ON "external_sheet_locks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_sheet_locks_update AFTER UPDATE ON "external_sheet_locks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_steps_insert AFTER INSERT ON "external_steps" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_steps_delete AFTER DELETE ON "external_steps" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_steps_update AFTER UPDATE ON "external_steps" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_workflows_insert AFTER INSERT ON "external_workflows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_workflows_delete AFTER DELETE ON "external_workflows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_external_workflows_update AFTER UPDATE ON "external_workflows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_confirmations_insert AFTER INSERT ON "extraction_confirmations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_confirmations_delete AFTER DELETE ON "extraction_confirmations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_confirmations_update AFTER UPDATE ON "extraction_confirmations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_jobs_insert AFTER INSERT ON "extraction_jobs" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_jobs_delete AFTER DELETE ON "extraction_jobs" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_jobs_update AFTER UPDATE ON "extraction_jobs" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_pages_insert AFTER INSERT ON "extraction_pages" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_pages_delete AFTER DELETE ON "extraction_pages" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_pages_update AFTER UPDATE ON "extraction_pages" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_results_insert AFTER INSERT ON "extraction_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_results_delete AFTER DELETE ON "extraction_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_results_update AFTER UPDATE ON "extraction_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_sources_insert AFTER INSERT ON "extraction_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_sources_delete AFTER DELETE ON "extraction_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_extraction_sources_update AFTER UPDATE ON "extraction_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_feedback_insert AFTER INSERT ON "feedback" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_feedback_delete AFTER DELETE ON "feedback" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_feedback_update AFTER UPDATE ON "feedback" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_connections_insert AFTER INSERT ON "google_connections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_connections_delete AFTER DELETE ON "google_connections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_connections_update AFTER UPDATE ON "google_connections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_material_sources_insert AFTER INSERT ON "google_material_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_material_sources_delete AFTER DELETE ON "google_material_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_material_sources_update AFTER UPDATE ON "google_material_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_provider_blocks_insert AFTER INSERT ON "google_provider_blocks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_provider_blocks_delete AFTER DELETE ON "google_provider_blocks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_provider_blocks_update AFTER UPDATE ON "google_provider_blocks" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_quota_charges_insert AFTER INSERT ON "google_quota_charges" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_quota_charges_delete AFTER DELETE ON "google_quota_charges" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_quota_charges_update AFTER UPDATE ON "google_quota_charges" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_quota_policies_insert AFTER INSERT ON "google_quota_policies" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_quota_policies_delete AFTER DELETE ON "google_quota_policies" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_quota_policies_update AFTER UPDATE ON "google_quota_policies" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_reference_reads_insert AFTER INSERT ON "google_reference_reads" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_reference_reads_delete AFTER DELETE ON "google_reference_reads" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_reference_reads_update AFTER UPDATE ON "google_reference_reads" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_report_folders_insert AFTER INSERT ON "google_report_folders" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_report_folders_delete AFTER DELETE ON "google_report_folders" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_report_folders_update AFTER UPDATE ON "google_report_folders" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_report_setups_insert AFTER INSERT ON "google_report_setups" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_report_setups_delete AFTER DELETE ON "google_report_setups" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_report_setups_update AFTER UPDATE ON "google_report_setups" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_requests_insert AFTER INSERT ON "google_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_requests_delete AFTER DELETE ON "google_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_requests_update AFTER UPDATE ON "google_requests" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_resources_insert AFTER INSERT ON "google_resources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_resources_delete AFTER DELETE ON "google_resources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_google_resources_update AFTER UPDATE ON "google_resources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_help_events_insert AFTER INSERT ON "help_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_help_events_delete AFTER DELETE ON "help_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_help_events_update AFTER UPDATE ON "help_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_learning_results_insert AFTER INSERT ON "learning_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_learning_results_delete AFTER DELETE ON "learning_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_learning_results_update AFTER UPDATE ON "learning_results" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_librarian_link_sources_insert AFTER INSERT ON "librarian_link_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_librarian_link_sources_delete AFTER DELETE ON "librarian_link_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_librarian_link_sources_update AFTER UPDATE ON "librarian_link_sources" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_librarian_links_insert AFTER INSERT ON "librarian_links" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_librarian_links_delete AFTER DELETE ON "librarian_links" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_librarian_links_update AFTER UPDATE ON "librarian_links" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_exposures_insert AFTER INSERT ON "material_exposures" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_exposures_delete AFTER DELETE ON "material_exposures" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_exposures_update AFTER UPDATE ON "material_exposures" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_files_insert AFTER INSERT ON "material_files" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_files_delete AFTER DELETE ON "material_files" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_files_update AFTER UPDATE ON "material_files" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_inventory_insert AFTER INSERT ON "material_inventory" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_inventory_delete AFTER DELETE ON "material_inventory" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_inventory_update AFTER UPDATE ON "material_inventory" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_pages_insert AFTER INSERT ON "material_pages" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_pages_delete AFTER DELETE ON "material_pages" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_pages_update AFTER UPDATE ON "material_pages" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_transfers_insert AFTER INSERT ON "material_transfers" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_transfers_delete AFTER DELETE ON "material_transfers" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_material_transfers_update AFTER UPDATE ON "material_transfers" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_materials_insert AFTER INSERT ON "materials" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_materials_delete AFTER DELETE ON "materials" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_materials_update AFTER UPDATE ON "materials" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plan_drafts_insert AFTER INSERT ON "plan_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plan_drafts_delete AFTER DELETE ON "plan_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plan_drafts_update AFTER UPDATE ON "plan_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plan_versions_insert AFTER INSERT ON "plan_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plan_versions_delete AFTER DELETE ON "plan_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plan_versions_update AFTER UPDATE ON "plan_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plans_insert AFTER INSERT ON "plans" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plans_delete AFTER DELETE ON "plans" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_plans_update AFTER UPDATE ON "plans" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_questions_insert AFTER INSERT ON "questions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_questions_delete AFTER DELETE ON "questions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_questions_update AFTER UPDATE ON "questions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_reservations_insert AFTER INSERT ON "quota_reservations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_reservations_delete AFTER DELETE ON "quota_reservations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_reservations_update AFTER UPDATE ON "quota_reservations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_usage_insert AFTER INSERT ON "quota_usage" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_usage_delete AFTER DELETE ON "quota_usage" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_usage_update AFTER UPDATE ON "quota_usage" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_windows_insert AFTER INSERT ON "quota_windows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_windows_delete AFTER DELETE ON "quota_windows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_quota_windows_update AFTER UPDATE ON "quota_windows" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_reference_selections_insert AFTER INSERT ON "reference_selections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_reference_selections_delete AFTER DELETE ON "reference_selections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_reference_selections_update AFTER UPDATE ON "reference_selections" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_result_next_actions_insert AFTER INSERT ON "result_next_actions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_result_next_actions_delete AFTER DELETE ON "result_next_actions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_result_next_actions_update AFTER UPDATE ON "result_next_actions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_result_review_targets_insert AFTER INSERT ON "result_review_targets" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_result_review_targets_delete AFTER DELETE ON "result_review_targets" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_result_review_targets_update AFTER UPDATE ON "result_review_targets" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_attempts_insert AFTER INSERT ON "review_attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_attempts_delete AFTER DELETE ON "review_attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_attempts_update AFTER UPDATE ON "review_attempts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_items_insert AFTER INSERT ON "review_items" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_items_delete AFTER DELETE ON "review_items" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_items_update AFTER UPDATE ON "review_items" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_plans_insert AFTER INSERT ON "review_plans" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_plans_delete AFTER DELETE ON "review_plans" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_plans_update AFTER UPDATE ON "review_plans" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_proposals_insert AFTER INSERT ON "review_proposals" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_proposals_delete AFTER DELETE ON "review_proposals" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_proposals_update AFTER UPDATE ON "review_proposals" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_schedule_insert AFTER INSERT ON "review_schedule" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_schedule_delete AFTER DELETE ON "review_schedule" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_schedule_update AFTER UPDATE ON "review_schedule" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_sessions_insert AFTER INSERT ON "review_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_sessions_delete AFTER DELETE ON "review_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_review_sessions_update AFTER UPDATE ON "review_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_revisions_insert AFTER INSERT ON "revisions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_revisions_delete AFTER DELETE ON "revisions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_revisions_update AFTER UPDATE ON "revisions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_scope_events_insert AFTER INSERT ON "scope_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_scope_events_delete AFTER DELETE ON "scope_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_scope_events_update AFTER UPDATE ON "scope_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_session_confirmations_insert AFTER INSERT ON "session_confirmations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_session_confirmations_delete AFTER DELETE ON "session_confirmations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_session_confirmations_update AFTER UPDATE ON "session_confirmations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_sessions_insert AFTER INSERT ON "sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_sessions_delete AFTER DELETE ON "sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_sessions_update AFTER UPDATE ON "sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_source_references_insert AFTER INSERT ON "source_references" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_source_references_delete AFTER DELETE ON "source_references" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_source_references_update AFTER UPDATE ON "source_references" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_study_scopes_insert AFTER INSERT ON "study_scopes" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_study_scopes_delete AFTER DELETE ON "study_scopes" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_study_scopes_update AFTER UPDATE ON "study_scopes" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_events_insert AFTER INSERT ON "tutor_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_events_delete AFTER DELETE ON "tutor_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_events_update AFTER UPDATE ON "tutor_events" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_help_deliveries_insert AFTER INSERT ON "tutor_help_deliveries" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_help_deliveries_delete AFTER DELETE ON "tutor_help_deliveries" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_help_deliveries_update AFTER UPDATE ON "tutor_help_deliveries" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_help_details_insert AFTER INSERT ON "tutor_help_details" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_help_details_delete AFTER DELETE ON "tutor_help_details" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_help_details_update AFTER UPDATE ON "tutor_help_details" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_sessions_insert AFTER INSERT ON "tutor_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_sessions_delete AFTER DELETE ON "tutor_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_sessions_update AFTER UPDATE ON "tutor_sessions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_variations_insert AFTER INSERT ON "tutor_variations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_variations_delete AFTER DELETE ON "tutor_variations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_tutor_variations_update AFTER UPDATE ON "tutor_variations" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_units_insert AFTER INSERT ON "units" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_units_delete AFTER DELETE ON "units" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_units_update AFTER UPDATE ON "units" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_uploads_insert AFTER INSERT ON "uploads" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_uploads_delete AFTER DELETE ON "uploads" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_uploads_update AFTER UPDATE ON "uploads" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_drafts_insert AFTER INSERT ON "weekly_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_drafts_delete AFTER DELETE ON "weekly_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_drafts_update AFTER UPDATE ON "weekly_drafts" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_evidence_insert AFTER INSERT ON "weekly_evidence" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_evidence_delete AFTER DELETE ON "weekly_evidence" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_evidence_update AFTER UPDATE ON "weekly_evidence" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_snapshots_insert AFTER INSERT ON "weekly_snapshots" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_snapshots_delete AFTER DELETE ON "weekly_snapshots" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_snapshots_update AFTER UPDATE ON "weekly_snapshots" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_summaries_insert AFTER INSERT ON "weekly_summaries" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_summaries_delete AFTER DELETE ON "weekly_summaries" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_summaries_update AFTER UPDATE ON "weekly_summaries" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_versions_insert AFTER INSERT ON "weekly_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_versions_delete AFTER DELETE ON "weekly_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_weekly_versions_update AFTER UPDATE ON "weekly_versions" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_write_targets_insert AFTER INSERT ON "write_targets" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (NEW.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_write_targets_delete AFTER DELETE ON "write_targets" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
--> statement-breakpoint
CREATE TRIGGER backup_write_targets_update AFTER UPDATE ON "write_targets" BEGIN INSERT INTO backup_revisions(owner_id,revision) VALUES (OLD.owner_id,1) ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; INSERT INTO backup_revisions(owner_id,revision) SELECT NEW.owner_id,1 WHERE NEW.owner_id <> OLD.owner_id ON CONFLICT(owner_id) DO UPDATE SET revision=revision+1; END;
