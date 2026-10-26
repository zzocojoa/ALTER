CREATE TRIGGER external_workflow_binding BEFORE INSERT ON external_workflows
WHEN NOT EXISTS(SELECT 1 FROM external_jobs j JOIN google_connections c ON c.owner_id=j.owner_id WHERE j.owner_id=NEW.owner_id AND j.id=NEW.id AND j.kind=NEW.kind AND c.id=NEW.connection_id AND c.google_subject=NEW.google_subject)
BEGIN SELECT RAISE(ABORT,'external_workflow_binding'); END;
--> statement-breakpoint
CREATE TRIGGER external_workflow_snapshot_immutable BEFORE UPDATE OF owner_id,id,kind,target_key,source_version,request_hash,snapshot,connection_id,google_subject,generation,created_at,deadline_at ON external_workflows
BEGIN SELECT RAISE(ABORT,'external_workflow_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER external_workflow_confirmation BEFORE UPDATE OF state ON external_workflows
WHEN NEW.state='confirmed' AND (NOT EXISTS(SELECT 1 FROM external_operations WHERE owner_id=NEW.owner_id AND workflow_id=NEW.id) OR EXISTS(SELECT 1 FROM external_operations WHERE owner_id=NEW.owner_id AND workflow_id=NEW.id AND state!='confirmed'))
BEGIN SELECT RAISE(ABORT,'external_workflow_unverified'); END;
--> statement-breakpoint
CREATE TRIGGER external_operation_parent BEFORE INSERT ON external_operations
WHEN NOT EXISTS(SELECT 1 FROM external_steps WHERE owner_id=NEW.owner_id AND id=NEW.step_id AND job_id=NEW.workflow_id)
BEGIN SELECT RAISE(ABORT,'external_operation_wrong_parent'); END;
--> statement-breakpoint
CREATE TRIGGER external_operation_snapshot_immutable BEFORE UPDATE OF owner_id,id,workflow_id,step_id,ordinal,kind,business_key,snapshot,request_hash,expected_hash ON external_operations
BEGIN SELECT RAISE(ABORT,'external_operation_snapshot_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER external_operation_identity_immutable BEFORE UPDATE OF external_id ON external_operations
WHEN OLD.external_id IS NOT NULL AND NEW.external_id IS NOT OLD.external_id
BEGIN SELECT RAISE(ABORT,'external_operation_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER external_operation_intent_immutable BEFORE UPDATE OF intent_at ON external_operations
WHEN OLD.intent_at IS NOT NULL AND NEW.intent_at IS NOT OLD.intent_at
BEGIN SELECT RAISE(ABORT,'external_operation_intent_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER external_operation_transition BEFORE UPDATE OF state ON external_operations
WHEN NOT ((OLD.state=NEW.state AND OLD.state NOT IN ('confirmed','conflict')) OR (OLD.state IN ('pending','received','unknown','failed') AND NEW.state='running') OR (OLD.state='running' AND NEW.state='pending' AND OLD.intent_at IS NULL AND coalesce(json_extract(NEW.verification,'$.status'),'')='not-executed' AND coalesce(json_extract(NEW.verification,'$.fencedEpoch'),-1)=OLD.lease_epoch AND coalesce(json_extract(NEW.verification,'$.priorEpoch'),OLD.lease_epoch)<OLD.lease_epoch) OR (OLD.state='running' AND NEW.state IN ('received','confirmed','failed','unknown','conflict')))
BEGIN SELECT RAISE(ABORT,'external_operation_transition'); END;
--> statement-breakpoint
CREATE TRIGGER external_attempt_parent BEFORE INSERT ON external_attempt_records
WHEN NOT EXISTS(SELECT 1 FROM external_operations WHERE owner_id=NEW.owner_id AND id=NEW.operation_id AND state='running' AND lease_id=NEW.lease_id AND lease_epoch=NEW.lease_epoch AND attempt_count=NEW.ordinal)
BEGIN SELECT RAISE(ABORT,'external_attempt_wrong_lease'); END;
--> statement-breakpoint
CREATE TRIGGER external_attempt_finished_immutable BEFORE UPDATE ON external_attempt_records
WHEN OLD.finished_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'external_attempt_finished_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER external_attempt_identity_immutable BEFORE UPDATE OF owner_id,id,operation_id,ordinal,lease_id,lease_epoch,mode,started_at ON external_attempt_records
BEGIN SELECT RAISE(ABORT,'external_attempt_identity_immutable'); END;
--> statement-breakpoint
CREATE TRIGGER external_attempt_history_required BEFORE DELETE ON external_attempt_records
BEGIN SELECT RAISE(ABORT,'external_attempt_history_required'); END;
--> statement-breakpoint
CREATE TRIGGER external_request_alias_immutable BEFORE UPDATE ON external_request_keys
BEGIN SELECT RAISE(ABORT,'external_request_alias_immutable'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX external_workflow_open_target ON external_workflows(owner_id,kind,target_key) WHERE state!='confirmed';
--> statement-breakpoint
CREATE UNIQUE INDEX external_workflow_single_successor ON external_workflows(owner_id,json_extract(snapshot,'$.predecessorId')) WHERE json_extract(snapshot,'$.predecessorId') IS NOT NULL;
--> statement-breakpoint
CREATE TRIGGER external_workflow_predecessor BEFORE INSERT ON external_workflows
WHEN (json_extract(NEW.snapshot,'$.predecessorId') IS NULL AND EXISTS(SELECT 1 FROM external_workflows WHERE owner_id=NEW.owner_id AND kind=NEW.kind AND target_key=NEW.target_key)) OR (json_extract(NEW.snapshot,'$.predecessorId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM external_workflows w WHERE w.owner_id=NEW.owner_id AND w.id=json_extract(NEW.snapshot,'$.predecessorId') AND w.kind=NEW.kind AND w.target_key=NEW.target_key AND w.google_subject=NEW.google_subject AND w.state='confirmed'))
BEGIN SELECT RAISE(ABORT,'external_workflow_predecessor_required'); END;
