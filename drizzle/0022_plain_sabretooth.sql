CREATE TABLE `tutor_help_deliveries` (
	`owner_id` text NOT NULL,
	`help_id` text NOT NULL,
	`delivered_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `help_id`),
	FOREIGN KEY (`owner_id`,`help_id`) REFERENCES `tutor_help_details`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tutor_help_details` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`session_id` text NOT NULL,
	`answer_id` text NOT NULL,
	`stage` text NOT NULL,
	`content` text NOT NULL,
	`committed_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `help_events`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `tutor_sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`answer_id`) REFERENCES `answers`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutor_help_details_content" CHECK(json_valid(content) AND stage IN ('direction','small-question','similar-example','full-explanation'))
);

--> statement-breakpoint
CREATE TRIGGER tutor_help_details_immutable_update BEFORE UPDATE ON tutor_help_details BEGIN SELECT RAISE(ABORT,'immutable_tutor_help_details'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_help_details_immutable_delete BEFORE DELETE ON tutor_help_details WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_tutor_help_details'); END;

--> statement-breakpoint
CREATE TRIGGER tutor_help_deliveries_immutable_update BEFORE UPDATE ON tutor_help_deliveries BEGIN SELECT RAISE(ABORT,'immutable_tutor_help_deliveries'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_help_deliveries_immutable_delete BEFORE DELETE ON tutor_help_deliveries WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_tutor_help_deliveries'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_help_requires_context BEFORE INSERT ON tutor_help_details WHEN NOT EXISTS(SELECT 1 FROM help_events h JOIN attempts active ON active.owner_id=h.owner_id AND active.id=h.attempt_id JOIN answers a ON a.owner_id=h.owner_id AND a.id=NEW.answer_id JOIN attempts previous ON previous.owner_id=a.owner_id AND previous.id=a.attempt_id WHERE h.owner_id=NEW.owner_id AND h.id=NEW.id AND h.shown_at=NEW.committed_at AND active.session_id=NEW.session_id AND previous.session_id=active.session_id AND previous.question_id=active.question_id AND active.id!=previous.id AND json_extract(NEW.content,'$.questionId')=active.question_id AND json_extract(NEW.content,'$.answerId')=a.id AND json_extract(NEW.content,'$.stage')=NEW.stage AND a.submitted_at<=h.shown_at AND ((NEW.stage='direction' AND h.kind='hint' AND h.level=1) OR (NEW.stage='small-question' AND h.kind='hint' AND h.level=2) OR (NEW.stage='similar-example' AND h.kind='explanation' AND h.level=2) OR (NEW.stage='full-explanation' AND h.kind='answer' AND h.level=3))) BEGIN SELECT RAISE(ABORT,'invalid_tutor_help_context'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_help_delivery_time BEFORE INSERT ON tutor_help_deliveries WHEN NOT EXISTS(SELECT 1 FROM tutor_help_details WHERE owner_id=NEW.owner_id AND id=NEW.help_id AND committed_at<=NEW.delivered_at) BEGIN SELECT RAISE(ABORT,'invalid_tutor_help_delivery'); END;
