CREATE TABLE `answer_files` (
	`owner_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`material_id` text NOT NULL,
	`linked_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `answer_id`, `material_id`),
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`material_id`) REFERENCES `material_files`(`owner_id`,`material_id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE `material_exposures` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`material_id` text NOT NULL,
	`attempt_id` text NOT NULL,
	`help_event_id` text NOT NULL,
	`shown_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`material_id`) REFERENCES `material_files`(`owner_id`,`material_id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`attempt_id`) REFERENCES `attempts`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`owner_id`,`help_event_id`) REFERENCES `help_events`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_exposure_once` ON `material_exposures` (`owner_id`,`attempt_id`,`material_id`);