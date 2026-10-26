CREATE TABLE `extraction_pages` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`job_id` text NOT NULL,
	`selection_revision` integer NOT NULL,
	`file_page` integer NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`result_id` text,
	`state` text NOT NULL,
	`printed_page` text,
	`pending_ai_key` text,
	`pending_image` text,
	`failure` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`job_id`) REFERENCES `extraction_jobs`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "extraction_page_version" CHECK(typeof(version)='integer' AND version>=1 AND selection_revision>=1 AND file_page BETWEEN 1 AND 500 AND result_version>=0),
	CONSTRAINT "extraction_page_state" CHECK(state IN ('pending','running','complete','failed','unknown')),
	CONSTRAINT "extraction_page_result" CHECK((result_version=0 AND result_id IS NULL) OR (result_version>0 AND result_id IS NOT NULL)),
	CONSTRAINT "extraction_page_pending" CHECK(state NOT IN ('running','unknown') OR (pending_ai_key IS NOT NULL AND pending_image IS NOT NULL)),
	CONSTRAINT "extraction_page_image" CHECK(pending_image IS NULL OR json_valid(pending_image))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraction_page_scope` ON `extraction_pages` (`owner_id`,`job_id`,`selection_revision`,`file_page`);--> statement-breakpoint
CREATE TABLE `extraction_results` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`page_id` text NOT NULL,
	`result_version` integer NOT NULL,
	`upload_id` text NOT NULL,
	`original_version` text NOT NULL,
	`original_hash` text NOT NULL,
	`result` text NOT NULL,
	`image` text,
	`ai_call_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`page_id`) REFERENCES `extraction_pages`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`upload_id`) REFERENCES `uploads`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "extraction_result_payload" CHECK(json_valid(result) AND result_version>=1 AND length(original_hash)=64),
	CONSTRAINT "extraction_result_image" CHECK(image IS NULL OR json_valid(image)),
	CONSTRAINT "extraction_result_ai" CHECK(json_extract(result,'$.method')!='vision' OR (ai_call_id IS NOT NULL AND image IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `extraction_result_version` ON `extraction_results` (`owner_id`,`page_id`,`result_version`);--> statement-breakpoint
CREATE TRIGGER extraction_results_immutable_update BEFORE UPDATE ON extraction_results BEGIN SELECT RAISE(ABORT, 'immutable_extraction_results'); END;
--> statement-breakpoint
CREATE TRIGGER extraction_results_immutable_delete BEFORE DELETE ON extraction_results WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:' || id AND state='cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_extraction_results'); END;
