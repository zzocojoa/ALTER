ALTER TABLE `corrections` ADD `created_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `reference_selections_unique_1` ON `reference_selections` (`owner_id`,`material_id`);