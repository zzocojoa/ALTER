CREATE TABLE `external_google_requests` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`batch_subrequests` integer NOT NULL,
	`response_upper_bytes` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `google_requests`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`attempt_id`) REFERENCES `external_attempt_records`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_google_request_counts" CHECK(batch_subrequests>=0 AND batch_subrequests<=2 AND response_upper_bytes>=65536)
);
