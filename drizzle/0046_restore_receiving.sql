CREATE TABLE `restore_archives` (
	`run_id` text PRIMARY KEY NOT NULL,
	`manifest_key` text NOT NULL,
	`manifest_sha256` text NOT NULL,
	`manifest_bytes` integer NOT NULL,
	`reserved_bytes` integer NOT NULL,
	`state` text NOT NULL,
	`object_version` text,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `restore_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_archive_capacity" CHECK("restore_archives"."manifest_bytes" BETWEEN 1 AND 8388608 AND "restore_archives"."reserved_bytes">="restore_archives"."manifest_bytes"+3072 AND "restore_archives"."reserved_bytes"<=268435456),
	CONSTRAINT "restore_archive_state" CHECK(("restore_archives"."state"='reserved' AND "restore_archives"."object_version" IS NULL AND "restore_archives"."ready_at" IS NULL) OR ("restore_archives"."state"='ready' AND "restore_archives"."object_version" IS NOT NULL AND length("restore_archives"."object_version")>0 AND "restore_archives"."ready_at" IS NOT NULL AND "restore_archives"."ready_at">="restore_archives"."created_at")),
	CONSTRAINT "restore_archive_time" CHECK("restore_archives"."created_at">=0)
);
--> statement-breakpoint
CREATE TABLE `restore_page_receipts` (
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`object_key` text NOT NULL,
	`object_version` text NOT NULL,
	`bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `path`),
	FOREIGN KEY (`run_id`) REFERENCES `restore_archives`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_page_receipt_size" CHECK("restore_page_receipts"."bytes" BETWEEN 1 AND 4194304 AND "restore_page_receipts"."received_at">=0 AND length("restore_page_receipts"."object_version")>0)
);

--> statement-breakpoint
CREATE TRIGGER restore_archive_insert BEFORE INSERT ON restore_archives
WHEN NEW.state<>'reserved' OR NOT EXISTS(SELECT 1 FROM restore_runs r WHERE r.id=NEW.run_id AND r.state='receiving' AND json_extract(r.authorization,'$.manifestSha256')=NEW.manifest_sha256)
BEGIN SELECT RAISE(ABORT,'invalid_restore_archive'); END;
--> statement-breakpoint
CREATE TRIGGER restore_archive_immutable BEFORE UPDATE ON restore_archives
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.manifest_key IS NOT OLD.manifest_key OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.manifest_bytes IS NOT OLD.manifest_bytes OR NEW.reserved_bytes IS NOT OLD.reserved_bytes OR NEW.created_at IS NOT OLD.created_at OR OLD.state='ready'
BEGIN SELECT RAISE(ABORT,'immutable_restore_archive'); END;
--> statement-breakpoint
CREATE TRIGGER restore_archive_delete BEFORE DELETE ON restore_archives BEGIN SELECT RAISE(ABORT,'immutable_restore_archive'); END;
--> statement-breakpoint
CREATE TRIGGER restore_page_receipt_insert BEFORE INSERT ON restore_page_receipts
WHEN NOT EXISTS(SELECT 1 FROM restore_runs r JOIN restore_archives a ON a.run_id=r.id WHERE r.id=NEW.run_id AND r.state='receiving' AND a.state='ready')
BEGIN SELECT RAISE(ABORT,'invalid_restore_page_receipt'); END;
--> statement-breakpoint
CREATE TRIGGER restore_page_receipt_update BEFORE UPDATE ON restore_page_receipts BEGIN SELECT RAISE(ABORT,'immutable_restore_page_receipt'); END;
--> statement-breakpoint
CREATE TRIGGER restore_page_receipt_delete BEFORE DELETE ON restore_page_receipts BEGIN SELECT RAISE(ABORT,'immutable_restore_page_receipt'); END;
