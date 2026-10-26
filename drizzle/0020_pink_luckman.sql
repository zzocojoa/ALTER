CREATE TABLE `result_next_actions` (
	`owner_id` text NOT NULL,
	`result_version_id` text NOT NULL,
	`next_action` text NOT NULL,
	PRIMARY KEY(`owner_id`, `result_version_id`),
	FOREIGN KEY (`owner_id`,`result_version_id`) REFERENCES `confirmed_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "result_next_action_text" CHECK(length(trim(next_action))>0)
);
--> statement-breakpoint
CREATE TABLE `review_schedule` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`review_id` text NOT NULL,
	`review_version` integer NOT NULL,
	`question_id` text NOT NULL,
	`basis_result_version_id` text NOT NULL,
	`correction_id` text,
	`due_date` text NOT NULL,
	`kind` text NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`review_id`) REFERENCES `review_items`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`question_id`) REFERENCES `questions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`basis_result_version_id`) REFERENCES `confirmed_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`correction_id`) REFERENCES `corrections`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_schedule_values" CHECK(version>=1 AND review_version>=1 AND kind IN ('variable','delayed-recall') AND state IN ('pending','complete') AND length(due_date)=10)
);
--> statement-breakpoint
CREATE TRIGGER result_next_actions_immutable_update BEFORE UPDATE ON result_next_actions BEGIN SELECT RAISE(ABORT,'immutable_result_next_actions'); END;
--> statement-breakpoint
CREATE TRIGGER result_next_actions_immutable_delete BEFORE DELETE ON result_next_actions BEGIN SELECT RAISE(ABORT,'immutable_result_next_actions'); END;
--> statement-breakpoint
CREATE TRIGGER review_schedule_reference_insert BEFORE INSERT ON review_schedule WHEN NOT EXISTS(SELECT 1 FROM review_items r JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN questions q ON q.owner_id=r.owner_id AND q.id=NEW.question_id JOIN sessions s ON s.owner_id=q.owner_id AND s.id=q.session_id JOIN confirmed_results c ON c.owner_id=r.owner_id AND c.id=NEW.basis_result_version_id JOIN learning_results l ON l.owner_id=c.owner_id AND l.id=c.result_id WHERE r.owner_id=NEW.owner_id AND r.id=NEW.review_id AND e.unit_id=s.unit_id AND l.unit_id=e.unit_id) BEGIN SELECT RAISE(ABORT,'invalid_review_schedule_reference'); END;
