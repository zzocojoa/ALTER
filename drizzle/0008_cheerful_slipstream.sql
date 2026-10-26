CREATE TABLE `ai_funding_checks` (
	`owner_id` text NOT NULL,
	`reservation_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `reservation_id`),
	FOREIGN KEY (`owner_id`,`reservation_id`) REFERENCES `cost_reservations`(`owner_id`,`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "ai_funding_snapshot" CHECK(json_valid(snapshot) AND json_extract(snapshot,'$.ownerId') = owner_id AND json_extract(snapshot,'$.automaticRecharge') = 0)
);

--> statement-breakpoint
CREATE TRIGGER ai_funding_no_update BEFORE UPDATE ON ai_funding_checks BEGIN SELECT RAISE(ABORT,'immutable_ai_funding'); END;
--> statement-breakpoint
CREATE TRIGGER ai_funding_no_delete BEFORE DELETE ON ai_funding_checks WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id) BEGIN SELECT RAISE(ABORT,'immutable_ai_funding'); END;
