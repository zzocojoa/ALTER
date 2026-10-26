CREATE TABLE `restore_originals` (
	`run_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`plan` text NOT NULL,
	`source_pages` text NOT NULL,
	`state` text NOT NULL,
	`object_version` text,
	`etag` text,
	`created_at` integer NOT NULL,
	`verified_at` integer,
	PRIMARY KEY(`run_id`, `ordinal`),
	FOREIGN KEY (`run_id`) REFERENCES `restore_archives`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_original_plan" CHECK(json_valid("restore_originals"."plan") AND json_valid("restore_originals"."source_pages") AND length(CAST("restore_originals"."plan" AS BLOB)) BETWEEN 1 AND 8192 AND "restore_originals"."ordinal" BETWEEN 0 AND 9999),
	CONSTRAINT "restore_original_state" CHECK(("restore_originals"."state"='reserved' AND "restore_originals"."object_version" IS NULL AND "restore_originals"."etag" IS NULL AND "restore_originals"."verified_at" IS NULL) OR ("restore_originals"."state"='verified' AND "restore_originals"."object_version" IS NOT NULL AND length("restore_originals"."object_version")>0 AND "restore_originals"."etag" IS NOT NULL AND length("restore_originals"."etag")>0 AND "restore_originals"."verified_at" IS NOT NULL AND "restore_originals"."verified_at">="restore_originals"."created_at")),
	CONSTRAINT "restore_original_time" CHECK("restore_originals"."created_at">=0)
);

--> statement-breakpoint
CREATE TRIGGER restore_original_insert BEFORE INSERT ON restore_originals
WHEN NEW.state<>'reserved' OR NOT EXISTS(SELECT 1 FROM restore_runs r JOIN restore_archives a ON a.run_id=r.id WHERE r.id=NEW.run_id AND r.state='receiving' AND a.state='ready')
BEGIN SELECT RAISE(ABORT,'invalid_restore_original'); END;
--> statement-breakpoint
CREATE TRIGGER restore_original_immutable BEFORE UPDATE ON restore_originals
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.ordinal IS NOT OLD.ordinal OR NEW.plan IS NOT OLD.plan OR NEW.source_pages IS NOT OLD.source_pages OR NEW.created_at IS NOT OLD.created_at OR OLD.state='verified'
BEGIN SELECT RAISE(ABORT,'immutable_restore_original'); END;
--> statement-breakpoint
CREATE TRIGGER restore_original_delete BEFORE DELETE ON restore_originals BEGIN SELECT RAISE(ABORT,'immutable_restore_original'); END;
