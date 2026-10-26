CREATE TRIGGER material_transfer_identity BEFORE UPDATE ON material_transfers WHEN NEW.owner_id IS NOT OLD.owner_id OR NEW.id IS NOT OLD.id OR NEW.material_id IS NOT OLD.material_id OR NEW.metadata IS NOT OLD.metadata OR NEW.version != OLD.version+1 OR (OLD.multipart_id IS NOT NULL AND NEW.multipart_id IS NOT OLD.multipart_id) OR (OLD.object_version IS NOT NULL AND (NEW.object_version IS NOT OLD.object_version OR NEW.etag IS NOT OLD.etag OR NEW.actual_hash IS NOT OLD.actual_hash OR NEW.actual_bytes IS NOT OLD.actual_bytes)) OR (OLD.validation IS NOT NULL AND NEW.validation IS NOT OLD.validation) BEGIN SELECT RAISE(ABORT,'immutable_material_transfer_facts'); END;
--> statement-breakpoint
CREATE TRIGGER material_transfer_transition BEFORE UPDATE ON material_transfers WHEN NOT (
 (OLD.state='reserved' AND NEW.state IN ('transferring','cleaning')) OR
 (OLD.state='transferring' AND NEW.state IN ('transferring','stored','unknown','failed')) OR
 (OLD.state='unknown' AND NEW.state IN ('unknown','stored','failed')) OR
 (OLD.state='stored' AND NEW.state IN ('validating','failed','cleaning')) OR
 (OLD.state='validating' AND NEW.state IN ('validating','verified','failed','cleaning')) OR
 (OLD.state='verified' AND NEW.state IN ('registered','cleaning')) OR
 (OLD.state='failed' AND NEW.state='cleaning') OR
 (OLD.state='cleaning' AND NEW.state IN ('cleaning','discarded'))
) BEGIN SELECT RAISE(ABORT,'invalid_material_transfer_transition'); END;
--> statement-breakpoint
CREATE TRIGGER material_transfer_insert BEFORE INSERT ON material_transfers WHEN NEW.state != 'reserved' OR NEW.write_status != 'not-started' OR NEW.version != 1 OR NEW.object_version IS NOT NULL OR NEW.validation IS NOT NULL OR NOT EXISTS(SELECT 1 FROM uploads u JOIN materials m ON m.owner_id=u.owner_id AND m.id=u.material_id WHERE u.owner_id=NEW.owner_id AND u.id=NEW.id AND u.material_id=NEW.material_id AND u.bytes=json_extract(NEW.metadata,'$.bytes') AND u.expected_hash=json_extract(NEW.metadata,'$.sha256') AND m.title=json_extract(NEW.metadata,'$.title')) BEGIN SELECT RAISE(ABORT,'invalid_material_transfer_insert'); END;
--> statement-breakpoint
CREATE TRIGGER material_transfer_capacity BEFORE INSERT ON material_transfers WHEN NOT EXISTS(SELECT 1 FROM material_inventory i WHERE i.owner_id=NEW.owner_id AND i.blocked=0 AND i.checked_at<=NEW.updated_at AND i.valid_until>NEW.updated_at AND i.untracked_bytes + COALESCE((SELECT SUM(u.bytes) FROM material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE t.owner_id=NEW.owner_id AND t.state!='discarded'),0) + json_extract(NEW.metadata,'$.bytes') <= 268435456 AND NOT EXISTS(SELECT 1 FROM material_transfers t WHERE t.owner_id=NEW.owner_id AND t.state NOT IN ('registered','discarded'))) BEGIN SELECT RAISE(ABORT,'invalid_material_capacity'); END;
--> statement-breakpoint
CREATE TRIGGER material_transfer_snapshot BEFORE UPDATE ON material_transfers WHEN
 (NEW.state='transferring' AND NEW.write_status!='active') OR
 (NEW.state='unknown' AND NEW.write_status!='unknown') OR
 (NEW.state IN ('stored','validating','verified','registered') AND NEW.write_status!='succeeded') OR
 (NEW.state IN ('cleaning','discarded') AND NEW.write_status NOT IN ('not-started','succeeded','aborted')) OR
 (NEW.state IN ('verified','registered') AND (NEW.validation IS NULL OR json_extract(NEW.validation,'$.objectVersion') IS NOT NEW.object_version OR json_extract(NEW.validation,'$.etag') IS NOT NEW.etag OR json_extract(NEW.validation,'$.sha256') IS NOT NEW.actual_hash OR json_extract(NEW.validation,'$.bytes') IS NOT NEW.actual_bytes OR json_extract(NEW.validation,'$.kind') IS NOT json_extract(NEW.metadata,'$.kind') OR json_extract(NEW.validation,'$.policyVersion') IS NOT 'materials-v2' OR NOT (json_extract(NEW.validation,'$.pages') BETWEEN 1 AND CASE WHEN json_extract(NEW.metadata,'$.kind')='pdf' THEN 500 ELSE 1 END)))
 BEGIN SELECT RAISE(ABORT,'invalid_material_transfer_snapshot'); END;
--> statement-breakpoint
CREATE TRIGGER material_upload_projection BEFORE UPDATE ON uploads WHEN EXISTS(SELECT 1 FROM material_transfers t WHERE t.owner_id=OLD.owner_id AND t.id=OLD.id AND (NEW.version!=t.version OR NEW.material_id IS NOT OLD.material_id OR NEW.object_key IS NOT OLD.object_key OR NEW.upload_id IS NOT OLD.upload_id OR NEW.bytes IS NOT OLD.bytes OR NEW.expected_hash IS NOT OLD.expected_hash OR NEW.state != CASE WHEN t.state='registered' THEN 'verified' WHEN t.state='discarded' THEN 'missing' WHEN t.state='unknown' THEN 'unknown' WHEN t.state IN ('failed','cleaning') THEN 'quarantined' WHEN t.state IN ('stored','validating','verified') THEN 'object-written' ELSE 'reserved' END)) BEGIN SELECT RAISE(ABORT,'invalid_material_upload_projection'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_requires_verified BEFORE INSERT ON material_files WHEN NOT EXISTS(SELECT 1 FROM material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE t.owner_id=NEW.owner_id AND t.id=NEW.transfer_id AND t.material_id=NEW.material_id AND t.state='registered' AND u.state='verified' AND u.version=t.version AND u.verified_hash=u.expected_hash) BEGIN SELECT RAISE(ABORT,'invalid_material_file_registration'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_immutable_update BEFORE UPDATE ON material_files BEGIN SELECT RAISE(ABORT,'immutable_material_file'); END;
--> statement-breakpoint
CREATE TRIGGER material_file_immutable_delete BEFORE DELETE ON material_files WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_material_file'); END;
--> statement-breakpoint
CREATE TRIGGER material_transfer_immutable_delete BEFORE DELETE ON material_transfers WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:'||id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_material_transfer'); END;
