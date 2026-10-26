CREATE TABLE `extraction_jobs` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`upload_id` text NOT NULL,
	`selection` text NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `materials`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`upload_id`,`id`) REFERENCES `uploads`(`owner_id`,`id`,`material_id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "extraction_job_version" CHECK(typeof(version)='integer' AND version>=1),
	CONSTRAINT "extraction_job_selection" CHECK(json_valid(selection) AND json_extract(selection,'$.materialId')=id AND json_array_length(selection,'$.pages') BETWEEN 1 AND 20)
);
