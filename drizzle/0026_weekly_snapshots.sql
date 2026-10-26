CREATE TABLE `weekly_snapshots` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`content` text NOT NULL,
	`fingerprint` text NOT NULL,
	`export_job_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `weekly_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`export_job_id`) REFERENCES `external_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "weekly_snapshot_content" CHECK(json_valid(content) AND length(fingerprint)=64 AND confirmed_at>=0)
);
--> statement-breakpoint
CREATE TRIGGER weekly_snapshot_immutable_update BEFORE UPDATE ON weekly_snapshots BEGIN SELECT RAISE(ABORT,'immutable_weekly_snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_snapshot_immutable_delete BEFORE DELETE ON weekly_snapshots BEGIN SELECT RAISE(ABORT,'immutable_weekly_snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_snapshot_export_binding BEFORE INSERT ON weekly_snapshots WHEN NOT EXISTS(SELECT 1 FROM external_jobs j JOIN weekly_versions v ON v.owner_id=j.owner_id AND v.id=j.weekly_version_id WHERE j.owner_id=NEW.owner_id AND j.id=NEW.export_job_id AND j.kind='weekly-export' AND v.id=NEW.id AND v.summary_id=json_extract(NEW.content,'$.id') AND v.ordinal=json_extract(NEW.content,'$.version') AND json_extract(NEW.content,'$.confirmedVersionId')=NEW.id AND json_extract(NEW.content,'$.phase')='confirmed' AND json_extract(NEW.content,'$.fingerprint')=NEW.fingerprint) BEGIN SELECT RAISE(ABORT,'invalid_weekly_snapshot_export'); END;
