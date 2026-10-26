CREATE TABLE `restore_verification_items` (
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`kind` text NOT NULL,
	`sha256` text NOT NULL,
	`projected_sha256` text,
	`object_version` text,
	`verified_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `path`),
	FOREIGN KEY (`run_id`) REFERENCES `restore_verifications`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_verification_item" CHECK("restore_verification_items"."verified_at">=0 AND length("restore_verification_items"."sha256")=64 AND (("restore_verification_items"."kind"='page' AND "restore_verification_items"."projected_sha256" IS NOT NULL AND length("restore_verification_items"."projected_sha256")=64 AND "restore_verification_items"."object_version" IS NULL) OR ("restore_verification_items"."kind"='original' AND "restore_verification_items"."projected_sha256" IS NULL AND "restore_verification_items"."object_version" IS NOT NULL AND length("restore_verification_items"."object_version")>0)))
);
--> statement-breakpoint
CREATE TABLE `restore_verifications` (
	`run_id` text PRIMARY KEY NOT NULL,
	`manifest_sha256` text NOT NULL,
	`revision` integer NOT NULL,
	`page_count` integer NOT NULL,
	`object_count` integer NOT NULL,
	`row_count` integer NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `restore_imports`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_verification_bounds" CHECK("restore_verifications"."revision">=0 AND "restore_verifications"."page_count" BETWEEN 1 AND 10000 AND "restore_verifications"."object_count" BETWEEN 0 AND 10000 AND "restore_verifications"."row_count">=0 AND "restore_verifications"."started_at">=0 AND ("restore_verifications"."completed_at" IS NULL OR "restore_verifications"."completed_at">="restore_verifications"."started_at"))
);

--> statement-breakpoint
CREATE TRIGGER restore_verification_start BEFORE INSERT ON restore_verifications
WHEN NEW.completed_at IS NOT NULL OR NOT EXISTS(SELECT 1 FROM restore_runs r JOIN restore_imports i ON i.run_id=r.id WHERE r.id=NEW.run_id AND r.state='verifying' AND i.loaded_pages=i.expected_pages AND i.expected_pages=NEW.page_count AND i.manifest_sha256=NEW.manifest_sha256 AND NEW.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0)) OR EXISTS(SELECT 1 FROM restore_import_scopes)
BEGIN SELECT RAISE(ABORT,'invalid_restore_verification'); END;
--> statement-breakpoint
CREATE TRIGGER restore_verification_immutable BEFORE UPDATE ON restore_verifications
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.revision IS NOT OLD.revision OR NEW.page_count IS NOT OLD.page_count OR NEW.object_count IS NOT OLD.object_count OR NEW.row_count IS NOT OLD.row_count OR NEW.started_at IS NOT OLD.started_at OR OLD.completed_at IS NOT NULL OR NEW.completed_at IS NULL
BEGIN SELECT RAISE(ABORT,'immutable_restore_verification'); END;
--> statement-breakpoint
CREATE TRIGGER restore_verification_delete BEFORE DELETE ON restore_verifications BEGIN SELECT RAISE(ABORT,'immutable_restore_verification'); END;
--> statement-breakpoint
CREATE TRIGGER restore_verification_item_insert BEFORE INSERT ON restore_verification_items
WHEN NOT EXISTS(SELECT 1 FROM restore_verifications v JOIN restore_runs r ON r.id=v.run_id WHERE v.run_id=NEW.run_id AND v.completed_at IS NULL AND r.state='verifying' AND v.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=r.owner_id),0))
OR (NEW.kind='page' AND NOT EXISTS(SELECT 1 FROM restore_import_pages p WHERE p.run_id=NEW.run_id AND p.path=NEW.path AND p.source_sha256=NEW.sha256 AND p.projected_sha256=NEW.projected_sha256))
OR (NEW.kind='original' AND NOT EXISTS(SELECT 1 FROM restore_originals o WHERE o.run_id=NEW.run_id AND o.state='verified' AND json_extract(o.plan,'$.entry.path')=NEW.path AND json_extract(o.plan,'$.entry.sha256')=NEW.sha256 AND o.object_version=NEW.object_version))
BEGIN SELECT RAISE(ABORT,'invalid_restore_verification_item'); END;
--> statement-breakpoint
CREATE TRIGGER restore_verification_item_update BEFORE UPDATE ON restore_verification_items BEGIN SELECT RAISE(ABORT,'immutable_restore_verification_item'); END;
--> statement-breakpoint
CREATE TRIGGER restore_verification_item_delete BEFORE DELETE ON restore_verification_items BEGIN SELECT RAISE(ABORT,'immutable_restore_verification_item'); END;
--> statement-breakpoint
CREATE TRIGGER restore_verified_requires_checks BEFORE UPDATE OF state ON restore_runs
WHEN NEW.state='verified' AND (OLD.state<>'verifying' OR NOT EXISTS(SELECT 1 FROM restore_verifications v WHERE v.run_id=NEW.id AND v.completed_at IS NOT NULL AND v.revision=COALESCE((SELECT revision FROM backup_revisions WHERE owner_id=NEW.owner_id),0) AND (SELECT count(*) FROM restore_verification_items WHERE run_id=NEW.id AND kind='page')=v.page_count AND (SELECT count(*) FROM restore_verification_items WHERE run_id=NEW.id AND kind='original')=v.object_count))
BEGIN SELECT RAISE(ABORT,'restore_verification_incomplete'); END;
