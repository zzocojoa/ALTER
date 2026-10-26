CREATE TABLE `tutor_variations` (
	`owner_id` text NOT NULL,
	`question_id` text NOT NULL,
	`parent_question_id` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `question_id`),
	FOREIGN KEY (`owner_id`,`question_id`) REFERENCES `questions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`parent_question_id`) REFERENCES `questions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tutor_variation_content" CHECK(json_valid(content) AND question_id!=parent_question_id AND json_extract(content,'$.questionId')=question_id AND json_extract(content,'$.parentQuestionId')=parent_question_id)
);

--> statement-breakpoint
CREATE TRIGGER tutor_variations_immutable_update BEFORE UPDATE ON tutor_variations BEGIN SELECT RAISE(ABORT,'immutable_tutor_variations'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_variations_immutable_delete BEFORE DELETE ON tutor_variations WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_tutor_variations'); END;
--> statement-breakpoint
CREATE TRIGGER tutor_variation_help_references BEFORE INSERT ON tutor_variations WHEN EXISTS(SELECT 1 FROM json_each(NEW.content,'$.helpEventIds') e WHERE NOT EXISTS(SELECT 1 FROM help_events h JOIN attempts a ON a.owner_id=h.owner_id AND a.id=h.attempt_id WHERE h.owner_id=NEW.owner_id AND h.id=e.value AND a.question_id=NEW.parent_question_id)) OR NOT EXISTS(SELECT 1 FROM questions previous JOIN questions current ON current.owner_id=previous.owner_id AND current.session_id=previous.session_id WHERE previous.owner_id=NEW.owner_id AND previous.id=NEW.parent_question_id AND current.id=NEW.question_id) BEGIN SELECT RAISE(ABORT,'invalid_tutor_variation_reference'); END;
