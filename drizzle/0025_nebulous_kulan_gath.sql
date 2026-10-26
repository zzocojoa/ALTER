CREATE TABLE `review_plans` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`evidence` text NOT NULL,
	`task` text NOT NULL,
	`current_proposal_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`id`) REFERENCES `review_items`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_plan_values" CHECK(version>=1 AND json_valid(evidence) AND json_valid(task))
);
--> statement-breakpoint
CREATE TABLE `review_proposals` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`review_id` text NOT NULL,
	`basis_result_version_id` text NOT NULL,
	`previous_id` text,
	`proposal` text NOT NULL,
	`decision` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`review_id`) REFERENCES `review_plans`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`basis_result_version_id`) REFERENCES `confirmed_results`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_proposal_values" CHECK(json_valid(proposal) AND json_valid(decision) AND created_at>=0)
);
--> statement-breakpoint
CREATE TABLE `review_sessions` (
	`owner_id` text NOT NULL,
	`session_id` text NOT NULL,
	`review_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`binding` text NOT NULL,
	PRIMARY KEY(`owner_id`, `session_id`),
	FOREIGN KEY (`owner_id`,`session_id`) REFERENCES `sessions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`review_id`) REFERENCES `review_plans`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`schedule_id`) REFERENCES `review_schedule`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_session_binding" CHECK(json_valid(binding))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_schedule_session` ON `review_sessions` (`owner_id`,`schedule_id`);--> statement-breakpoint
CREATE TRIGGER review_plan_evidence BEFORE INSERT ON review_plans WHEN NOT EXISTS(
 SELECT 1 FROM confirmed_results c JOIN session_confirmations sc ON sc.owner_id=c.owner_id AND sc.result_version_id=c.id JOIN result_review_targets rt ON rt.owner_id=c.owner_id AND rt.result_version_id=c.id JOIN review_items r ON r.owner_id=rt.owner_id AND r.id=rt.review_id JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN answers a ON a.owner_id=e.owner_id AND a.id=e.answer_id JOIN attempts t ON t.owner_id=a.owner_id AND t.id=a.attempt_id
 WHERE c.owner_id=NEW.owner_id AND r.id=NEW.id AND c.id=json_extract(NEW.evidence,'$.resultVersionId') AND c.ordinal=json_extract(NEW.evidence,'$.resultOrdinal') AND a.id=json_extract(NEW.evidence,'$.answerId') AND a.ordinal=json_extract(NEW.evidence,'$.answerVersion') AND t.question_id=json_extract(NEW.evidence,'$.questionId') AND rt.answer_id=a.id AND json_array_length(NEW.evidence,'$.helpIds')=(SELECT count(*) FROM help_events h JOIN attempts p ON p.owner_id=h.owner_id AND p.id=h.attempt_id WHERE p.owner_id=t.owner_id AND p.question_id=t.question_id) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence,'$.helpIds') h WHERE NOT EXISTS(SELECT 1 FROM help_events e JOIN attempts p ON p.owner_id=e.owner_id AND p.id=e.attempt_id WHERE e.owner_id=t.owner_id AND e.id=h.value AND p.question_id=t.question_id)) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence,'$.sourceRefIds') s WHERE NOT EXISTS(SELECT 1 FROM source_references r WHERE r.owner_id=NEW.owner_id AND r.id=s.value)) AND EXISTS(SELECT 1 FROM json_each(NEW.evidence,'$.sourceRefIds') s WHERE s.value=r.source_ref_id)
) BEGIN SELECT RAISE(ABORT,'invalid_review_official_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER review_plan_evidence_immutable BEFORE UPDATE ON review_plans WHEN NEW.evidence!=OLD.evidence BEGIN SELECT RAISE(ABORT,'immutable_review_original_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER review_proposal_immutable_update BEFORE UPDATE ON review_proposals BEGIN SELECT RAISE(ABORT,'immutable_review_proposal'); END;
--> statement-breakpoint
CREATE TRIGGER review_proposal_immutable_delete BEFORE DELETE ON review_proposals BEGIN SELECT RAISE(ABORT,'immutable_review_proposal'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX review_proposal_official_once ON review_proposals(owner_id,review_id,basis_result_version_id) WHERE json_extract(decision,'$.status')='proposed';
--> statement-breakpoint
CREATE TRIGGER review_session_immutable_update BEFORE UPDATE ON review_sessions BEGIN SELECT RAISE(ABORT,'immutable_review_session'); END;
--> statement-breakpoint
CREATE TRIGGER review_session_immutable_delete BEFORE DELETE ON review_sessions BEGIN SELECT RAISE(ABORT,'immutable_review_session'); END;
