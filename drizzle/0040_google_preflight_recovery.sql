DROP TRIGGER external_operation_transition;
--> statement-breakpoint
CREATE TRIGGER external_operation_transition BEFORE UPDATE OF state ON external_operations
WHEN NOT ((OLD.state=NEW.state AND OLD.state NOT IN ('confirmed','conflict')) OR (OLD.state IN ('pending','received','unknown','failed') AND NEW.state='running') OR (OLD.state='running' AND NEW.state='pending' AND (OLD.intent_at IS NULL OR coalesce(json_extract(NEW.verification,'$.basis'),'')='google-write-request-absent-and-fenced') AND coalesce(json_extract(NEW.verification,'$.status'),'')='not-executed' AND coalesce(json_extract(NEW.verification,'$.fencedEpoch'),-1)=OLD.lease_epoch AND coalesce(json_extract(NEW.verification,'$.priorEpoch'),OLD.lease_epoch)<OLD.lease_epoch) OR (OLD.state='running' AND NEW.state IN ('received','confirmed','failed','unknown','conflict')))
BEGIN SELECT RAISE(ABORT,'external_operation_transition'); END;
--> statement-breakpoint
CREATE TRIGGER external_google_preflight_proof BEFORE UPDATE OF state ON external_operations
WHEN NEW.state='pending' AND OLD.intent_at IS NOT NULL AND (
coalesce(json_extract(NEW.verification,'$.basis'),'')!='google-write-request-absent-and-fenced'
OR NOT EXISTS(SELECT 1 FROM external_attempt_records a JOIN external_google_requests g ON g.owner_id=a.owner_id AND g.attempt_id=a.id JOIN google_requests q ON q.owner_id=g.owner_id AND q.id=g.id WHERE a.owner_id=OLD.owner_id AND a.operation_id=OLD.id AND a.mode='write' AND a.lease_epoch<OLD.lease_epoch AND q.sent_at IS NOT NULL AND (q.method LIKE '%.get' OR q.method LIKE '%.list'))
OR EXISTS(SELECT 1 FROM external_attempt_records a LEFT JOIN google_requests q ON q.owner_id=a.owner_id AND q.id=a.id WHERE a.owner_id=OLD.owner_id AND a.operation_id=OLD.id AND a.mode='write' AND (a.finished_at IS NULL OR a.lease_epoch>=OLD.lease_epoch OR q.id IS NOT NULL))
OR EXISTS(SELECT 1 FROM external_attempt_records a JOIN external_google_requests g ON g.owner_id=a.owner_id AND g.attempt_id=a.id JOIN google_requests q ON q.owner_id=g.owner_id AND q.id=g.id WHERE a.owner_id=OLD.owner_id AND a.operation_id=OLD.id AND q.method NOT LIKE '%.get' AND q.method NOT LIKE '%.list'))
BEGIN SELECT RAISE(ABORT,'external_google_preflight_not_proven'); END;
