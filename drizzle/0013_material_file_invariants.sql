CREATE TRIGGER material_exposures_immutable_update BEFORE UPDATE ON material_exposures BEGIN SELECT RAISE(ABORT,'immutable_material_exposures'); END;
--> statement-breakpoint
CREATE TRIGGER material_exposures_immutable_delete BEFORE DELETE ON material_exposures WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_material_exposures'); END;
--> statement-breakpoint
CREATE TRIGGER material_exposures_require_help BEFORE INSERT ON material_exposures WHEN NOT EXISTS(SELECT 1 FROM help_events h JOIN attempts a ON a.owner_id=h.owner_id AND a.id=h.attempt_id WHERE h.owner_id=NEW.owner_id AND h.id=NEW.help_event_id AND h.attempt_id=NEW.attempt_id AND h.kind='explanation' AND h.level=3 AND h.shown_at=NEW.shown_at AND a.version=h.ordinal AND a.hidden_material=0 AND a.status='awaiting-answer') BEGIN SELECT RAISE(ABORT,'invalid_material_exposure_help'); END;
--> statement-breakpoint
CREATE TRIGGER answer_files_immutable_update BEFORE UPDATE ON answer_files BEGIN SELECT RAISE(ABORT,'immutable_answer_files'); END;
--> statement-breakpoint
CREATE TRIGGER answer_files_immutable_delete BEFORE DELETE ON answer_files WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_answer_files'); END;
--> statement-breakpoint
CREATE TRIGGER answer_files_require_valid_image BEFORE INSERT ON answer_files WHEN NOT EXISTS(SELECT 1 FROM answers a JOIN attempts t ON t.owner_id=a.owner_id AND t.id=a.attempt_id JOIN sessions s ON s.owner_id=t.owner_id AND s.id=t.session_id JOIN materials m ON m.owner_id=s.owner_id AND m.course_id=s.course_id JOIN material_files f ON f.owner_id=m.owner_id AND f.material_id=m.id JOIN material_transfers u ON u.owner_id=f.owner_id AND u.id=f.transfer_id WHERE a.owner_id=NEW.owner_id AND a.id=NEW.answer_id AND m.id=NEW.material_id AND u.state='registered' AND json_extract(u.metadata,'$.kind')='image' AND json_extract(u.metadata,'$.role')='answer' AND NEW.linked_at>=a.submitted_at) BEGIN SELECT RAISE(ABORT,'invalid_answer_file_reference'); END;
