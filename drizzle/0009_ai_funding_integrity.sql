DROP TRIGGER ai_funding_no_delete;
--> statement-breakpoint
CREATE TRIGGER ai_funding_no_delete BEFORE DELETE ON ai_funding_checks WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id=OLD.owner_id AND owner_id='verification:' || id AND state='cleaning') BEGIN SELECT RAISE(ABORT,'immutable_ai_funding'); END;
