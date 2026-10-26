CREATE TABLE `extraction_sources` (
	`owner_id` text NOT NULL,
	`source_id` text NOT NULL,
	`result_id` text NOT NULL,
	`segment_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `source_id`),
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `source_references`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`result_id`,`segment_id`) REFERENCES `extraction_confirmations`(`owner_id`,`result_id`,`segment_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraction_source_segment` ON `extraction_sources` (`owner_id`,`result_id`,`segment_id`);--> statement-breakpoint
DROP INDEX `material_pages_unique_0`;--> statement-breakpoint
ALTER TABLE `material_pages` ADD `result_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `material_pages_unique_0` ON `material_pages` (`owner_id`,`upload_id`,`file_page`,`result_version`);
--> statement-breakpoint
CREATE TRIGGER extraction_sources_immutable_update BEFORE UPDATE ON extraction_sources BEGIN SELECT RAISE(ABORT,'immutable_extraction_sources'); END;
--> statement-breakpoint
CREATE TRIGGER extraction_sources_immutable_delete BEFORE DELETE ON extraction_sources WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_extraction_sources'); END;
--> statement-breakpoint
CREATE TRIGGER extraction_confirmations_immutable_update BEFORE UPDATE ON extraction_confirmations BEGIN SELECT RAISE(ABORT,'immutable_extraction_confirmations'); END;
--> statement-breakpoint
CREATE TRIGGER extraction_confirmations_immutable_delete BEFORE DELETE ON extraction_confirmations WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_extraction_confirmations'); END;
