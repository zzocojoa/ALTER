CREATE TABLE `restore_google_reads` (
	`id` text PRIMARY KEY NOT NULL,
	`reconciliation_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`method` text NOT NULL,
	`project_id` text NOT NULL,
	`policy_version` integer NOT NULL,
	`policy_hash` text NOT NULL,
	`policy` text NOT NULL,
	`charges` text NOT NULL,
	`reserved_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`state` text NOT NULL,
	`sent_at` integer,
	`finished_at` integer,
	`status` integer,
	`error` text,
	FOREIGN KEY (`reconciliation_id`) REFERENCES `restore_reconciliations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_google_read_method" CHECK("restore_google_reads"."method" IN ('drive.files.get','drive.files.list','docs.documents.get','sheets.spreadsheets.get','sheets.values.get','calendar.calendars.get','calendar.events.get')),
	CONSTRAINT "restore_google_read_quota" CHECK("restore_google_reads"."policy_version">0 AND json_valid("restore_google_reads"."policy") AND json_valid("restore_google_reads"."charges") AND length(CAST("restore_google_reads"."policy" AS BLOB))<=65536 AND length(CAST("restore_google_reads"."charges" AS BLOB))<=16384 AND "restore_google_reads"."reserved_at">=0 AND "restore_google_reads"."expires_at">"restore_google_reads"."reserved_at"),
	CONSTRAINT "restore_google_read_state" CHECK(("restore_google_reads"."state"='reserved' AND "restore_google_reads"."sent_at" IS NULL AND "restore_google_reads"."finished_at" IS NULL) OR ("restore_google_reads"."state"='sending' AND "restore_google_reads"."sent_at">="restore_google_reads"."reserved_at" AND "restore_google_reads"."finished_at" IS NULL) OR ("restore_google_reads"."state" IN ('succeeded','failed','unknown') AND "restore_google_reads"."sent_at">="restore_google_reads"."reserved_at" AND "restore_google_reads"."finished_at">="restore_google_reads"."sent_at"))
);
--> statement-breakpoint
CREATE TABLE `restore_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`operation_version` integer NOT NULL,
	`connection_id` text NOT NULL,
	`generation` integer NOT NULL,
	`started_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`finished_at` integer,
	`proof` text,
	FOREIGN KEY (`run_id`) REFERENCES `restore_activations`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_reconciliation_bounds" CHECK("restore_reconciliations"."operation_version">0 AND "restore_reconciliations"."generation">0 AND "restore_reconciliations"."started_at">=0 AND "restore_reconciliations"."expires_at">"restore_reconciliations"."started_at" AND "restore_reconciliations"."expires_at"<="restore_reconciliations"."started_at"+60000),
	CONSTRAINT "restore_reconciliation_result" CHECK(("restore_reconciliations"."finished_at" IS NULL AND "restore_reconciliations"."proof" IS NULL) OR ("restore_reconciliations"."finished_at">="restore_reconciliations"."started_at" AND "restore_reconciliations"."proof" IS NOT NULL AND json_valid("restore_reconciliations"."proof") AND length(CAST("restore_reconciliations"."proof" AS BLOB))<=4096))
);

--> statement-breakpoint
CREATE TRIGGER restore_reconciliation_start BEFORE INSERT ON restore_reconciliations WHEN NOT EXISTS(SELECT 1 FROM restore_activations a JOIN restore_runs r ON r.id=a.run_id JOIN external_operations o ON o.owner_id=r.owner_id JOIN external_workflows w ON w.owner_id=o.owner_id AND w.id=o.workflow_id JOIN google_runtime g ON g.owner_id=r.owner_id JOIN google_connections c ON c.owner_id=g.owner_id AND c.id=g.connection_id WHERE a.run_id=NEW.run_id AND r.owner_id=NEW.owner_id AND r.state='activated' AND o.id=NEW.operation_id AND o.version=NEW.operation_version AND g.connection_id=NEW.connection_id AND g.generation=NEW.generation AND g.state IN ('active','partial') AND g.authorized_at>=a.activated_at AND c.google_subject=w.google_subject AND c.revoked_at IS NULL AND c.reconnect_required=0) BEGIN SELECT RAISE(ABORT,'restore_reconciliation_not_authorized'); END;
--> statement-breakpoint
CREATE TRIGGER restore_reconciliation_update BEFORE UPDATE ON restore_reconciliations WHEN NEW.id IS NOT OLD.id OR NEW.run_id IS NOT OLD.run_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.operation_id IS NOT OLD.operation_id OR NEW.operation_version IS NOT OLD.operation_version OR NEW.connection_id IS NOT OLD.connection_id OR NEW.generation IS NOT OLD.generation OR NEW.started_at IS NOT OLD.started_at OR NEW.expires_at IS NOT OLD.expires_at OR OLD.finished_at IS NOT NULL OR NEW.finished_at IS NULL OR NEW.proof IS NULL BEGIN SELECT RAISE(ABORT,'immutable_restore_reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER restore_reconciliation_delete BEFORE DELETE ON restore_reconciliations BEGIN SELECT RAISE(ABORT,'immutable_restore_reconciliation'); END;
--> statement-breakpoint
CREATE TRIGGER restore_google_read_insert BEFORE INSERT ON restore_google_reads WHEN NEW.state!='reserved' OR NOT EXISTS(SELECT 1 FROM restore_reconciliations r JOIN google_runtime g ON g.owner_id=r.owner_id AND g.connection_id=r.connection_id AND g.generation=r.generation WHERE r.id=NEW.reconciliation_id AND r.finished_at IS NULL AND r.expires_at>NEW.reserved_at AND g.state IN ('active','partial')) BEGIN SELECT RAISE(ABORT,'restore_google_read_not_authorized'); END;
--> statement-breakpoint
CREATE TRIGGER restore_google_read_update BEFORE UPDATE ON restore_google_reads WHEN NEW.id IS NOT OLD.id OR NEW.reconciliation_id IS NOT OLD.reconciliation_id OR NEW.request_hash IS NOT OLD.request_hash OR NEW.method IS NOT OLD.method OR NEW.project_id IS NOT OLD.project_id OR NEW.policy_version IS NOT OLD.policy_version OR NEW.policy_hash IS NOT OLD.policy_hash OR NEW.policy IS NOT OLD.policy OR NEW.charges IS NOT OLD.charges OR NEW.reserved_at IS NOT OLD.reserved_at OR NEW.expires_at IS NOT OLD.expires_at OR NOT ((OLD.state='reserved' AND NEW.state='sending' AND NEW.finished_at IS NULL) OR (OLD.state='sending' AND NEW.state IN ('succeeded','failed','unknown') AND NEW.sent_at IS OLD.sent_at AND NEW.finished_at IS NOT NULL)) BEGIN SELECT RAISE(ABORT,'immutable_restore_google_read'); END;
--> statement-breakpoint
CREATE TRIGGER restore_google_read_delete BEFORE DELETE ON restore_google_reads BEGIN SELECT RAISE(ABORT,'immutable_restore_google_read'); END;

--> statement-breakpoint
CREATE TRIGGER restore_reconciliation_proof BEFORE UPDATE OF proof ON restore_reconciliations WHEN json_extract(NEW.proof,'$.checkedAt')>NEW.finished_at OR json_extract(NEW.proof,'$.status') NOT IN ('matched','conflict','unknown') OR (json_extract(NEW.proof,'$.status')!='unknown' AND (NEW.finished_at>=NEW.expires_at OR NOT EXISTS(SELECT 1 FROM restore_activations a JOIN restore_runs r ON r.id=a.run_id JOIN external_operations o ON o.owner_id=r.owner_id JOIN external_workflows w ON w.owner_id=o.owner_id AND w.id=o.workflow_id JOIN google_runtime g ON g.owner_id=r.owner_id JOIN google_connections c ON c.owner_id=g.owner_id AND c.id=g.connection_id WHERE a.run_id=NEW.run_id AND r.owner_id=NEW.owner_id AND r.state='activated' AND o.id=NEW.operation_id AND o.version=NEW.operation_version AND g.connection_id=NEW.connection_id AND g.generation=NEW.generation AND g.state IN ('active','partial') AND g.authorized_at>=a.activated_at AND c.google_subject=w.google_subject AND c.revoked_at IS NULL AND c.reconnect_required=0))) BEGIN SELECT RAISE(ABORT,'restore_reconciliation_stale_proof'); END;
