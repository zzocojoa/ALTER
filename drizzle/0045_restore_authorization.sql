CREATE TABLE `restore_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`target_identity` text NOT NULL,
	`issued_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`consumed_run_id` text,
	CONSTRAINT "restore_challenge_time" CHECK("restore_challenges"."issued_at">=0 AND "restore_challenges"."expires_at">"restore_challenges"."issued_at" AND "restore_challenges"."expires_at"-"restore_challenges"."issued_at"<=900000 AND (("restore_challenges"."consumed_at" IS NULL AND "restore_challenges"."consumed_run_id" IS NULL) OR ("restore_challenges"."consumed_at" IS NOT NULL AND "restore_challenges"."consumed_run_id" IS NOT NULL AND "restore_challenges"."consumed_at">="restore_challenges"."issued_at" AND "restore_challenges"."consumed_at"<"restore_challenges"."expires_at")))
);
--> statement-breakpoint
CREATE TABLE `restore_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`challenge_id` text NOT NULL,
	`authorization` text NOT NULL,
	`started_at` integer NOT NULL,
	`state` text NOT NULL,
	FOREIGN KEY (`challenge_id`) REFERENCES `restore_challenges`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_run_state" CHECK("restore_runs"."state" IN ('receiving','verifying','verified','activated','failed')),
	CONSTRAINT "restore_run_authorization" CHECK(json_valid("restore_runs"."authorization") AND length(CAST("restore_runs"."authorization" AS BLOB)) BETWEEN 1 AND 8192 AND "restore_runs"."started_at">=0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `restore_runs_challenge_id_unique` ON `restore_runs` (`challenge_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX restore_single_run ON restore_runs((1));
--> statement-breakpoint
CREATE TRIGGER restore_challenge_immutable BEFORE UPDATE ON restore_challenges
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.target_identity IS NOT OLD.target_identity OR NEW.issued_at IS NOT OLD.issued_at OR NEW.expires_at IS NOT OLD.expires_at OR (OLD.consumed_at IS NOT NULL AND (NEW.consumed_at IS NOT OLD.consumed_at OR NEW.consumed_run_id IS NOT OLD.consumed_run_id))
BEGIN SELECT RAISE(ABORT, 'immutable_restore_challenge'); END;
--> statement-breakpoint
CREATE TRIGGER restore_challenge_delete_forbidden BEFORE DELETE ON restore_challenges
BEGIN SELECT RAISE(ABORT, 'immutable_restore_challenge'); END;
--> statement-breakpoint
CREATE TRIGGER restore_run_immutable BEFORE UPDATE ON restore_runs
WHEN NEW.id IS NOT OLD.id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.challenge_id IS NOT OLD.challenge_id OR NEW.authorization IS NOT OLD.authorization OR NEW.started_at IS NOT OLD.started_at
BEGIN SELECT RAISE(ABORT, 'immutable_restore_run'); END;
--> statement-breakpoint
CREATE TRIGGER restore_run_delete_forbidden BEFORE DELETE ON restore_runs
BEGIN SELECT RAISE(ABORT, 'immutable_restore_run'); END;

--> statement-breakpoint
CREATE TRIGGER restore_challenge_requires_storage BEFORE INSERT ON restore_challenges
WHEN NOT EXISTS(SELECT 1 FROM restore_storage WHERE slot=1 AND state='ready' AND identity=NEW.target_identity AND json_extract(identity,'$.purpose')='restore-test' AND json_extract(identity,'$.owner.userId')=NEW.owner_id)
BEGIN SELECT RAISE(ABORT, 'invalid_restore_challenge_storage'); END;
--> statement-breakpoint
CREATE TRIGGER restore_run_requires_consumed_challenge BEFORE INSERT ON restore_runs
WHEN NEW.state<>'receiving' OR NOT EXISTS(SELECT 1 FROM restore_challenges c WHERE c.id=NEW.challenge_id AND c.owner_id=NEW.owner_id AND c.consumed_run_id=NEW.id AND c.consumed_at IS NOT NULL AND c.target_identity=json_extract(NEW.authorization,'$.challenge.target') AND c.id=json_extract(NEW.authorization,'$.challenge.id')) OR json_extract(NEW.authorization,'$.restoredExecutionAuthority') IS NOT 'none' OR json_extract(NEW.authorization,'$.googleConsent') IS NOT 'required'
BEGIN SELECT RAISE(ABORT, 'invalid_restore_run_challenge'); END;
