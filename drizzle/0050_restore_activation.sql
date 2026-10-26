CREATE TABLE `restore_activations` (
	`run_id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`activated_at` integer NOT NULL,
	`external_authority` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `restore_verifications`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_activation_bounds" CHECK("restore_activations"."revision">=0 AND "restore_activations"."activated_at">=0 AND "restore_activations"."external_authority"='unverified')
);

--> statement-breakpoint
CREATE TRIGGER restore_activation_requires_verified BEFORE INSERT ON restore_activations
WHEN NOT EXISTS(SELECT 1 FROM restore_runs r JOIN restore_verifications v ON v.run_id=r.id JOIN restore_storage s ON s.slot=1
WHERE r.id=NEW.run_id AND r.state='verified' AND v.completed_at IS NOT NULL AND v.completed_at<=NEW.activated_at AND v.revision=NEW.revision AND v.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0)
AND s.state='ready' AND json_extract(s.identity,'$.purpose')='restore-test' AND json_extract(s.identity,'$.owner.userId')=r.owner_id
AND (SELECT count(*) FROM restore_verification_items WHERE run_id=r.id AND kind='page')=v.page_count AND (SELECT count(*) FROM restore_verification_items WHERE run_id=r.id AND kind='original')=v.object_count)
OR EXISTS(SELECT 1 FROM restore_import_scopes)
BEGIN SELECT RAISE(ABORT,'restore_activation_requires_current_verification'); END;
--> statement-breakpoint
CREATE TRIGGER restore_activation_update BEFORE UPDATE ON restore_activations BEGIN SELECT RAISE(ABORT,'immutable_restore_activation'); END;
--> statement-breakpoint
CREATE TRIGGER restore_activation_delete BEFORE DELETE ON restore_activations BEGIN SELECT RAISE(ABORT,'immutable_restore_activation'); END;
--> statement-breakpoint
CREATE TRIGGER restore_activation_state BEFORE UPDATE OF state ON restore_runs
WHEN (NEW.state='activated' AND (OLD.state<>'verified' OR NOT EXISTS(SELECT 1 FROM restore_activations a WHERE a.run_id=NEW.id AND a.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=NEW.owner_id),0)))) OR OLD.state='activated'
BEGIN SELECT RAISE(ABORT,'restore_activation_state_invalid'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_windows_insert BEFORE INSERT ON cost_windows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='cost_windows' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_windows_update BEFORE UPDATE ON cost_windows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_windows_delete BEFORE DELETE ON cost_windows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_reservations_insert BEFORE INSERT ON cost_reservations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='cost_reservations' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_reservations_update BEFORE UPDATE ON cost_reservations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_reservations_delete BEFORE DELETE ON cost_reservations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_usage_insert BEFORE INSERT ON cost_usage
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='cost_usage' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_usage_update BEFORE UPDATE ON cost_usage
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_cost_usage_delete BEFORE DELETE ON cost_usage
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_calls_insert BEFORE INSERT ON ai_calls
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='ai_calls' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_calls_update BEFORE UPDATE ON ai_calls
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_calls_delete BEFORE DELETE ON ai_calls
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_funding_checks_insert BEFORE INSERT ON ai_funding_checks
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='ai_funding_checks' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_funding_checks_update BEFORE UPDATE ON ai_funding_checks
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_funding_checks_delete BEFORE DELETE ON ai_funding_checks
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_cost_intents_insert BEFORE INSERT ON ai_cost_intents
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='ai_cost_intents' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_cost_intents_update BEFORE UPDATE ON ai_cost_intents
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_ai_cost_intents_delete BEFORE DELETE ON ai_cost_intents
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_jobs_insert BEFORE INSERT ON external_jobs
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='external_jobs' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_jobs_update BEFORE UPDATE ON external_jobs
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_jobs_delete BEFORE DELETE ON external_jobs
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_steps_insert BEFORE INSERT ON external_steps
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='external_steps' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_steps_update BEFORE UPDATE ON external_steps
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_steps_delete BEFORE DELETE ON external_steps
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_attempts_insert BEFORE INSERT ON external_attempts
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='external_attempts' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_attempts_update BEFORE UPDATE ON external_attempts
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_attempts_delete BEFORE DELETE ON external_attempts
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_workflows_insert BEFORE INSERT ON external_workflows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='external_workflows' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_workflows_update BEFORE UPDATE ON external_workflows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_workflows_delete BEFORE DELETE ON external_workflows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_operations_insert BEFORE INSERT ON external_operations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='external_operations' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_operations_update BEFORE UPDATE ON external_operations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_operations_delete BEFORE DELETE ON external_operations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_attempt_records_insert BEFORE INSERT ON external_attempt_records
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='external_attempt_records' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_attempt_records_update BEFORE UPDATE ON external_attempt_records
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_external_attempt_records_delete BEFORE DELETE ON external_attempt_records
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_requests_insert BEFORE INSERT ON google_requests
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='google_requests' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_requests_update BEFORE UPDATE ON google_requests
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_requests_delete BEFORE DELETE ON google_requests
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_quota_charges_insert BEFORE INSERT ON google_quota_charges
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='google_quota_charges' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_quota_charges_update BEFORE UPDATE ON google_quota_charges
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_quota_charges_delete BEFORE DELETE ON google_quota_charges
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_quota_policies_insert BEFORE INSERT ON google_quota_policies
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='google_quota_policies' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_quota_policies_update BEFORE UPDATE ON google_quota_policies
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_google_quota_policies_delete BEFORE DELETE ON google_quota_policies
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_quota_windows_insert BEFORE INSERT ON quota_windows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='quota_windows' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_quota_windows_update BEFORE UPDATE ON quota_windows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_quota_windows_delete BEFORE DELETE ON quota_windows
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_quota_reservations_insert BEFORE INSERT ON quota_reservations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test') AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE table_name='quota_reservations' AND owner_id=NEW.owner_id)
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_quota_reservations_update BEFORE UPDATE ON quota_reservations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;

--> statement-breakpoint
CREATE TRIGGER restore_execution_quota_reservations_delete BEFORE DELETE ON quota_reservations
WHEN EXISTS(SELECT 1 FROM restore_storage WHERE json_extract(identity,'$.purpose')='restore-test')
BEGIN SELECT RAISE(ABORT,'restore_current_execution_unverified'); END;
