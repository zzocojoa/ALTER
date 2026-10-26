CREATE TRIGGER google_reference_identity_immutable BEFORE UPDATE ON google_reference_reads
WHEN OLD.owner_id!=NEW.owner_id OR OLD.id!=NEW.id OR OLD.connection_id!=NEW.connection_id OR OLD.generation!=NEW.generation OR OLD.file_id!=NEW.file_id OR OLD.created_at!=NEW.created_at OR OLD.state!='reading'
BEGIN SELECT RAISE(ABORT,'immutable_google_reference_read'); END;
--> statement-breakpoint
CREATE TRIGGER google_reference_no_delete BEFORE DELETE ON google_reference_reads
BEGIN SELECT RAISE(ABORT,'immutable_google_reference_read'); END;
--> statement-breakpoint
CREATE TRIGGER google_material_source_proof BEFORE INSERT ON google_material_sources
WHEN NOT EXISTS(SELECT 1 FROM google_reference_reads r JOIN material_transfers t ON t.owner_id=r.owner_id WHERE r.owner_id=NEW.owner_id AND r.id=NEW.read_id AND r.state='verified' AND t.id=NEW.transfer_id AND t.material_id=NEW.material_id AND t.state='reserved' AND json_extract(r.proof,'$.sha256')=json_extract(t.metadata,'$.sha256') AND json_extract(r.proof,'$.bytes')=json_extract(t.metadata,'$.bytes') AND json_extract(r.proof,'$.mime')=json_extract(t.metadata,'$.mime') AND json_extract(t.metadata,'$.role')='reference')
BEGIN SELECT RAISE(ABORT,'invalid_google_source_proof'); END;
--> statement-breakpoint
CREATE TRIGGER google_material_source_no_update BEFORE UPDATE ON google_material_sources
BEGIN SELECT RAISE(ABORT,'immutable_google_material_source'); END;
--> statement-breakpoint
CREATE TRIGGER google_material_source_no_delete BEFORE DELETE ON google_material_sources
BEGIN SELECT RAISE(ABORT,'immutable_google_material_source'); END;
