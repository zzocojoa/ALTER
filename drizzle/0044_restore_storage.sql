CREATE TABLE `restore_storage` (
	`slot` integer PRIMARY KEY NOT NULL,
	`identity` text NOT NULL,
	`state` text NOT NULL,
	`marker_version` text,
	`marker_bytes` integer,
	`created_at` integer NOT NULL,
	`ready_at` integer,
	CONSTRAINT "restore_storage_slot" CHECK("restore_storage"."slot"=1),
	CONSTRAINT "restore_storage_identity" CHECK(json_valid("restore_storage"."identity") AND length(CAST("restore_storage"."identity" AS BLOB)) BETWEEN 1 AND 2048),
	CONSTRAINT "restore_storage_state" CHECK(("restore_storage"."state"='reserved' AND "restore_storage"."marker_version" IS NULL AND "restore_storage"."marker_bytes" IS NULL AND "restore_storage"."ready_at" IS NULL) OR ("restore_storage"."state"='ready' AND "restore_storage"."marker_version" IS NOT NULL AND length("restore_storage"."marker_version")>0 AND "restore_storage"."marker_bytes" IS NOT NULL AND "restore_storage"."ready_at" IS NOT NULL AND "restore_storage"."marker_bytes" BETWEEN 1 AND 2048 AND "restore_storage"."ready_at">="restore_storage"."created_at")),
	CONSTRAINT "restore_storage_time" CHECK("restore_storage"."created_at">=0)
);

--> statement-breakpoint
CREATE TRIGGER restore_storage_identity_immutable BEFORE UPDATE ON restore_storage
WHEN NEW.slot IS NOT OLD.slot OR NEW.identity IS NOT OLD.identity OR NEW.created_at IS NOT OLD.created_at OR (OLD.state='ready' AND (NEW.state IS NOT OLD.state OR NEW.marker_version IS NOT OLD.marker_version OR NEW.marker_bytes IS NOT OLD.marker_bytes OR NEW.ready_at IS NOT OLD.ready_at))
BEGIN SELECT RAISE(ABORT, 'immutable_restore_storage'); END;
--> statement-breakpoint
CREATE TRIGGER restore_storage_delete_forbidden BEFORE DELETE ON restore_storage
BEGIN SELECT RAISE(ABORT, 'immutable_restore_storage'); END;
