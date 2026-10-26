CREATE TRIGGER correction_requires_timestamp BEFORE INSERT ON corrections WHEN NEW.created_at IS NULL OR typeof(NEW.created_at) != 'integer' OR date(NEW.created_at / 1000,'unixepoch','+9 hours') != NEW.study_date BEGIN SELECT RAISE(ABORT, 'invalid_correction_timestamp'); END;
--> statement-breakpoint
CREATE TRIGGER review_requires_new_answer BEFORE INSERT ON review_attempts WHEN NEW.correction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM corrections c JOIN answers a ON a.owner_id = c.owner_id WHERE c.owner_id = NEW.owner_id AND c.id = NEW.correction_id AND a.id = NEW.answer_id AND a.submitted_at > c.created_at) BEGIN SELECT RAISE(ABORT, 'invalid_old_recheck_answer'); END;
--> statement-breakpoint
CREATE TRIGGER result_requires_new_answer BEFORE INSERT ON confirmed_results WHEN NEW.performance IN ('독립 수행','지연 재현') AND EXISTS(SELECT 1 FROM learning_results r JOIN errors e ON e.owner_id = r.owner_id AND e.unit_id = r.unit_id JOIN corrections c ON c.owner_id = e.owner_id AND c.error_id = e.id JOIN answers a ON a.owner_id = c.owner_id AND a.id = NEW.answer_id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.result_id AND (c.created_at IS NULL OR a.submitted_at <= c.created_at)) BEGIN SELECT RAISE(ABORT, 'invalid_old_confirmed_answer'); END;
--> statement-breakpoint
CREATE TRIGGER readonly_reference_no_write BEFORE INSERT ON write_targets WHEN EXISTS(SELECT 1 FROM reference_selections WHERE owner_id = NEW.owner_id AND connection_id = NEW.connection_id AND external_id = NEW.external_id) BEGIN SELECT RAISE(ABORT, 'invalid_reference_write'); END;
--> statement-breakpoint
CREATE TRIGGER write_target_no_reference BEFORE INSERT ON reference_selections WHEN EXISTS(SELECT 1 FROM write_targets WHERE owner_id = NEW.owner_id AND connection_id = NEW.connection_id AND external_id = NEW.external_id) BEGIN SELECT RAISE(ABORT, 'invalid_write_reference'); END;

--> statement-breakpoint
CREATE TRIGGER cost_windows_integer_insert BEFORE INSERT ON cost_windows WHEN typeof(NEW.limit_units) != 'integer' OR typeof(NEW.reserved_units) != 'integer' OR typeof(NEW.settled_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER cost_windows_integer_update BEFORE UPDATE ON cost_windows WHEN typeof(NEW.limit_units) != 'integer' OR typeof(NEW.reserved_units) != 'integer' OR typeof(NEW.settled_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER quota_windows_integer_insert BEFORE INSERT ON quota_windows WHEN typeof(NEW.limit_units) != 'integer' OR typeof(NEW.reserved_units) != 'integer' OR typeof(NEW.settled_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER quota_windows_integer_update BEFORE UPDATE ON quota_windows WHEN typeof(NEW.limit_units) != 'integer' OR typeof(NEW.reserved_units) != 'integer' OR typeof(NEW.settled_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER cost_reservations_integer_insert BEFORE INSERT ON cost_reservations WHEN typeof(NEW.amount_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER cost_reservations_integer_update BEFORE UPDATE ON cost_reservations WHEN typeof(NEW.amount_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER quota_reservations_integer_insert BEFORE INSERT ON quota_reservations WHEN typeof(NEW.weight) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER quota_reservations_integer_update BEFORE UPDATE ON quota_reservations WHEN typeof(NEW.weight) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER cost_usage_integer_insert BEFORE INSERT ON cost_usage WHEN typeof(NEW.actual_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER cost_usage_integer_update BEFORE UPDATE ON cost_usage WHEN typeof(NEW.actual_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER quota_usage_integer_insert BEFORE INSERT ON quota_usage WHEN typeof(NEW.actual_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;

--> statement-breakpoint
CREATE TRIGGER quota_usage_integer_update BEFORE UPDATE ON quota_usage WHEN typeof(NEW.actual_units) != 'integer' BEGIN SELECT RAISE(ABORT, 'invalid_integer_units'); END;
