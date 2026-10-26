CREATE TABLE `advisor_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`version` integer NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `advisor_sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "advisor_event_valid" CHECK(json_valid(content) AND version>=1 AND kind IN ('start','answer','begin','turn','plan','edit','confirm'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `advisor_event_version` ON `advisor_events` (`owner_id`,`session_id`,`version`);--> statement-breakpoint
CREATE TABLE `advisor_sessions` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	CONSTRAINT "advisor_state_valid" CHECK(json_valid(state) AND json_extract(state,'$.id')=id AND json_extract(state,'$.version')=version AND version>=1)
);

--> statement-breakpoint
CREATE TRIGGER advisor_events_immutable_update BEFORE UPDATE ON advisor_events BEGIN SELECT RAISE(ABORT,'immutable_advisor_event'); END;
--> statement-breakpoint
CREATE TRIGGER advisor_events_immutable_delete BEFORE DELETE ON advisor_events BEGIN SELECT RAISE(ABORT,'immutable_advisor_event'); END;
--> statement-breakpoint
CREATE TRIGGER advisor_history_preserved BEFORE UPDATE ON advisor_sessions WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.id IS NOT OLD.id OR NEW.version != OLD.version+1 OR json_extract(NEW.state,'$.conditions') IS NOT json_extract(OLD.state,'$.conditions') OR json_extract(NEW.state,'$.assessment') IS NOT json_extract(OLD.state,'$.assessment') OR json_extract(OLD.state,'$.phase')='confirmed' OR EXISTS(SELECT 1 FROM json_each(OLD.state,'$.answers') a WHERE a.value IS NOT json_extract(NEW.state,'$.answers['||a.key||']')) OR EXISTS(SELECT 1 FROM json_each(OLD.state,'$.estimates') a WHERE a.value IS NOT json_extract(NEW.state,'$.estimates['||a.key||']')) BEGIN SELECT RAISE(ABORT,'immutable_advisor_history'); END;
