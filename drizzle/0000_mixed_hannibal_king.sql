CREATE TABLE `owner_enrollment` (
	`slot` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`requested_at` integer NOT NULL
);
