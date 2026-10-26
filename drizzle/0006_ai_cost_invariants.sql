CREATE TRIGGER ai_pricing_versions_immutable_update BEFORE UPDATE ON ai_pricing_versions BEGIN SELECT RAISE(ABORT, 'immutable_ai_pricing_versions'); END;
--> statement-breakpoint
CREATE TRIGGER ai_pricing_versions_immutable_delete BEFORE DELETE ON ai_pricing_versions WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_ai_pricing_versions'); END;
--> statement-breakpoint
CREATE TRIGGER ai_cost_intents_immutable_update BEFORE UPDATE ON ai_cost_intents BEGIN SELECT RAISE(ABORT, 'immutable_ai_cost_intents'); END;
--> statement-breakpoint
CREATE TRIGGER ai_cost_intents_immutable_delete BEFORE DELETE ON ai_cost_intents WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_ai_cost_intents'); END;
--> statement-breakpoint
CREATE TRIGGER ai_budget_blocks_immutable_update BEFORE UPDATE ON ai_budget_blocks BEGIN SELECT RAISE(ABORT, 'immutable_ai_budget_blocks'); END;
--> statement-breakpoint
CREATE TRIGGER ai_budget_blocks_immutable_delete BEFORE DELETE ON ai_budget_blocks WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_ai_budget_blocks'); END;
--> statement-breakpoint
CREATE TRIGGER ai_intent_matches_reservation BEFORE INSERT ON ai_cost_intents WHEN NOT EXISTS(SELECT 1 FROM cost_reservations r JOIN ai_pricing_versions p ON p.owner_id = r.owner_id AND p.id = NEW.pricing_version_id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.id AND r.model = 'gpt-6-luna' AND r.amount_units = json_extract(NEW.bound,'$.amount.units') AND p.fingerprint = json_extract(NEW.bound,'$.pricingFingerprint')) BEGIN SELECT RAISE(ABORT, 'invalid_ai_reservation_bound'); END;
