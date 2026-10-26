CREATE TABLE `tutor_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `tutor_sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutor_event_content" CHECK(json_valid(content) AND version>=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tutor_event_version` ON `tutor_events` (`owner_id`,`session_id`,`version`);--> statement-breakpoint
CREATE TABLE `tutor_sessions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`scope_id` text NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`scope_id`) REFERENCES `study_scopes`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutor_session_state" CHECK(json_valid(state) AND version>=1 AND json_extract(state,'$.version')=version AND json_extract(state,'$.id')=id AND json_extract(state,'$.start.scopeId')=scope_id)
);

--> statement-breakpoint
CREATE TRIGGER tutor_events_immutable_update BEFORE UPDATE ON tutor_events BEGIN SELECT RAISE(ABORT,'immutable_tutor_events'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_events_immutable_delete BEFORE DELETE ON tutor_events WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_tutor_events'); END;
