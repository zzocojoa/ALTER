CREATE TABLE `extraction_confirmations` (
	`owner_id` text NOT NULL,
	`result_id` text NOT NULL,
	`segment_id` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `result_id`, `segment_id`),
	FOREIGN KEY (`owner_id`,`result_id`) REFERENCES `extraction_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict
);
