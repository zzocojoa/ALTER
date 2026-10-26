CREATE TRIGGER google_report_setup_immutable BEFORE UPDATE ON google_report_setups
BEGIN SELECT RAISE(ABORT,'google_report_setup_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER google_report_setup_history BEFORE DELETE ON google_report_setups
BEGIN SELECT RAISE(ABORT,'google_report_setup_history'); END;
--> statement-breakpoint
CREATE TRIGGER google_report_folder_receipt BEFORE INSERT ON google_report_folders
WHEN NOT EXISTS(SELECT 1 FROM google_requests q JOIN google_runtime r ON r.owner_id=q.owner_id AND r.connection_id=q.connection_id AND r.generation=q.generation WHERE q.owner_id=NEW.owner_id AND q.id=NEW.id AND q.connection_id=NEW.connection_id AND q.generation=NEW.generation AND q.method='drive.files.create' AND q.state='succeeded' AND q.result_external_id=NEW.external_id AND r.state IN ('active','partial'))
BEGIN SELECT RAISE(ABORT,'google_report_folder_receipt_required'); END;
--> statement-breakpoint
CREATE TRIGGER google_report_folder_immutable BEFORE UPDATE ON google_report_folders
BEGIN SELECT RAISE(ABORT,'google_report_folder_immutable'); END;
