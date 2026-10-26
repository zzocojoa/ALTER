DROP TRIGGER external_operation_transition;
--> statement-breakpoint
CREATE TRIGGER external_operation_transition BEFORE UPDATE OF state ON external_operations
WHEN NOT ((OLD.state=NEW.state AND OLD.state NOT IN ('confirmed','conflict')) OR (OLD.state IN ('pending','received','unknown','failed') AND NEW.state='running') OR (OLD.state='conflict' AND NEW.state='running' AND OLD.intent_at IS NOT NULL AND OLD.response_at IS NOT NULL AND OLD.external_id IS NOT NULL) OR (OLD.state='running' AND NEW.state='pending' AND (OLD.intent_at IS NULL OR coalesce(json_extract(NEW.verification,'$.basis'),'')='google-write-request-absent-and-fenced') AND coalesce(json_extract(NEW.verification,'$.status'),'')='not-executed' AND coalesce(json_extract(NEW.verification,'$.fencedEpoch'),-1)=OLD.lease_epoch AND coalesce(json_extract(NEW.verification,'$.priorEpoch'),OLD.lease_epoch)<OLD.lease_epoch) OR (OLD.state='running' AND NEW.state IN ('received','confirmed','failed','unknown','conflict')))
BEGIN SELECT RAISE(ABORT,'external_operation_transition'); END;
--> statement-breakpoint
CREATE TRIGGER external_conflict_write_block BEFORE INSERT ON external_attempt_records
WHEN NEW.mode='write' AND EXISTS(SELECT 1 FROM external_attempt_records a WHERE a.owner_id=NEW.owner_id AND a.operation_id=NEW.operation_id AND a.state='conflict')
BEGIN SELECT RAISE(ABORT,'external_conflict_read_only'); END;
