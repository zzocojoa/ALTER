CREATE TABLE `librarian_link_sources` (
	`owner_id` text NOT NULL,
	`link_id` text NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`owner_id`, `link_id`, `source_id`),
	FOREIGN KEY (`owner_id`,`link_id`) REFERENCES `librarian_links`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`source_id`) REFERENCES `source_references`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `librarian_links` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`material_id` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`plan_version_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`unit_id`) REFERENCES `units`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`material_id`) REFERENCES `materials`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "librarian_link_content" CHECK(json_valid(content) AND json_extract(content,'$.id')=id AND json_extract(content,'$.planVersionId')=plan_version_id AND json_extract(content,'$.unitId')=unit_id AND json_extract(content,'$.materialId')=material_id)
);
--> statement-breakpoint
CREATE TABLE `scope_events` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`scope_id` text NOT NULL,
	`version` integer NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`scope_id`) REFERENCES `study_scopes`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scope_event_content" CHECK(json_valid(content) AND version>=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scope_event_version` ON `scope_events` (`owner_id`,`scope_id`,`version`);--> statement-breakpoint
CREATE TABLE `study_scopes` (
	`owner_id` text NOT NULL,
	`id` text NOT NULL,
	`version` integer NOT NULL,
	`last_request_id` text NOT NULL,
	`plan_version_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`state` text NOT NULL,
	PRIMARY KEY(`owner_id`, `id`),
	FOREIGN KEY (`owner_id`,`plan_version_id`) REFERENCES `plan_versions`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`,`unit_id`) REFERENCES `units`(`owner_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "study_scope_state" CHECK(json_valid(state) AND version>=1 AND json_extract(state,'$.version')=version AND json_extract(state,'$.input.id')=id AND json_extract(state,'$.input.planVersionId')=plan_version_id AND json_extract(state,'$.input.unitId')=unit_id)
);

--> statement-breakpoint
CREATE TRIGGER librarian_links_immutable_update BEFORE UPDATE ON librarian_links BEGIN SELECT RAISE(ABORT,'immutable_librarian_links'); END;

--> statement-breakpoint
CREATE TRIGGER librarian_links_immutable_delete BEFORE DELETE ON librarian_links BEGIN SELECT RAISE(ABORT,'immutable_librarian_links'); END;

--> statement-breakpoint
CREATE TRIGGER librarian_link_sources_immutable_update BEFORE UPDATE ON librarian_link_sources BEGIN SELECT RAISE(ABORT,'immutable_librarian_link_sources'); END;

--> statement-breakpoint
CREATE TRIGGER librarian_link_sources_immutable_delete BEFORE DELETE ON librarian_link_sources BEGIN SELECT RAISE(ABORT,'immutable_librarian_link_sources'); END;

--> statement-breakpoint
CREATE TRIGGER scope_events_immutable_update BEFORE UPDATE ON scope_events BEGIN SELECT RAISE(ABORT,'immutable_scope_events'); END;

--> statement-breakpoint
CREATE TRIGGER scope_events_immutable_delete BEFORE DELETE ON scope_events BEGIN SELECT RAISE(ABORT,'immutable_scope_events'); END;

--> statement-breakpoint
CREATE TRIGGER study_scope_history BEFORE UPDATE ON study_scopes WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.id IS NOT OLD.id OR NEW.plan_version_id IS NOT OLD.plan_version_id OR NEW.unit_id IS NOT OLD.unit_id OR NEW.version!=OLD.version+1 OR json_extract(OLD.state,'$.phase')='confirmed' OR json_extract(NEW.state,'$.input') IS NOT json_extract(OLD.state,'$.input') OR json_extract(NEW.state,'$.unit') IS NOT json_extract(OLD.state,'$.unit') OR json_extract(NEW.state,'$.candidates') IS NOT json_extract(OLD.state,'$.candidates') OR json_extract(NEW.state,'$.prerequisites') IS NOT json_extract(OLD.state,'$.prerequisites') OR json_extract(NEW.state,'$.progress') IS NOT json_extract(OLD.state,'$.progress') BEGIN SELECT RAISE(ABORT,'immutable_scope_history'); END;
