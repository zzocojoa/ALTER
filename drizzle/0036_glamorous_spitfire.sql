CREATE TABLE `external_sheet_locks` (
	`owner_id` text NOT NULL,
	`google_subject` text NOT NULL,
	`external_id` text NOT NULL,
	`operation_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `google_subject`, `external_id`),
	FOREIGN KEY (`owner_id`,`operation_id`) REFERENCES `external_operations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "external_sheet_lock_identity" CHECK(length(google_subject)>0 AND length(external_id)>0)
);
