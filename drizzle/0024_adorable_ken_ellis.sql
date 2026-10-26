CREATE TABLE `result_review_targets` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`result_version_id` text NOT NULL,
	`review_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`kind` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`result_version_id`) REFERENCES `confirmed_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`review_id`) REFERENCES `review_items`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_review_target_values" CHECK(kind IN ('self-explanation','variable','delayed-recall') AND json_valid(content))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `result_review_target_kind` ON `result_review_targets` (`owner_id`,`result_version_id`,`kind`,`answer_id`);--> statement-breakpoint
CREATE TABLE `session_confirmations` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`result_version_id` text NOT NULL,
	`session_version` integer NOT NULL,
	`fingerprint` text NOT NULL,
	`judgment` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `session_id`),
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`result_version_id`) REFERENCES `confirmed_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "session_confirmation_values" CHECK(session_version>=1 AND length(fingerprint)=64 AND json_valid(judgment))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_confirmation_result` ON `session_confirmations` (`owner_id`,`result_version_id`);
--> statement-breakpoint
CREATE TRIGGER session_confirmations_immutable_update BEFORE UPDATE ON session_confirmations BEGIN SELECT RAISE(ABORT,'immutable_session_confirmations'); END;

--> statement-breakpoint
CREATE TRIGGER session_confirmations_immutable_delete BEFORE DELETE ON session_confirmations BEGIN SELECT RAISE(ABORT,'immutable_session_confirmations'); END;

--> statement-breakpoint
CREATE TRIGGER result_review_targets_immutable_update BEFORE UPDATE ON result_review_targets BEGIN SELECT RAISE(ABORT,'immutable_result_review_targets'); END;

--> statement-breakpoint
CREATE TRIGGER result_review_targets_immutable_delete BEFORE DELETE ON result_review_targets BEGIN SELECT RAISE(ABORT,'immutable_result_review_targets'); END;

--> statement-breakpoint
DROP TRIGGER correction_source_course;
--> statement-breakpoint
CREATE TRIGGER correction_source_course BEFORE INSERT ON corrections WHEN NOT EXISTS(SELECT 1 FROM errors e JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id JOIN source_references ref ON ref.owner_id=e.owner_id AND ref.id=NEW.source_ref_id JOIN materials m ON m.owner_id=ref.owner_id AND m.id=ref.material_id WHERE e.owner_id=NEW.owner_id AND e.id=NEW.error_id AND e.answer_id=NEW.answer_id AND e.concept=NEW.concept AND (m.course_id=u.course_id OR EXISTS(SELECT 1 FROM librarian_link_sources ls JOIN librarian_links l ON l.owner_id=ls.owner_id AND l.id=ls.link_id WHERE ls.owner_id=e.owner_id AND ls.source_id=ref.id AND l.material_id=m.id AND l.unit_id=u.id))) BEGIN SELECT RAISE(ABORT,'invalid_correction_source'); END;
