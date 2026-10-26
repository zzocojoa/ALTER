CREATE TRIGGER plan_versions_immutable_update BEFORE UPDATE ON plan_versions WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_plan_versions'); END;
--> statement-breakpoint
CREATE TRIGGER plan_versions_immutable_delete BEFORE DELETE ON plan_versions WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_plan_versions'); END;
--> statement-breakpoint
CREATE TRIGGER material_pages_immutable_update BEFORE UPDATE ON material_pages WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_material_pages'); END;
--> statement-breakpoint
CREATE TRIGGER material_pages_immutable_delete BEFORE DELETE ON material_pages WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_material_pages'); END;
--> statement-breakpoint
CREATE TRIGGER source_references_immutable_update BEFORE UPDATE ON source_references WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_source_references'); END;
--> statement-breakpoint
CREATE TRIGGER source_references_immutable_delete BEFORE DELETE ON source_references WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_source_references'); END;
--> statement-breakpoint
CREATE TRIGGER conversations_immutable_update BEFORE UPDATE ON conversations WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_conversations'); END;
--> statement-breakpoint
CREATE TRIGGER conversations_immutable_delete BEFORE DELETE ON conversations WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_conversations'); END;
--> statement-breakpoint
CREATE TRIGGER questions_immutable_update BEFORE UPDATE ON questions WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_questions'); END;
--> statement-breakpoint
CREATE TRIGGER questions_immutable_delete BEFORE DELETE ON questions WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_questions'); END;
--> statement-breakpoint
CREATE TRIGGER answers_immutable_update BEFORE UPDATE ON answers WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_answers'); END;
--> statement-breakpoint
CREATE TRIGGER answers_immutable_delete BEFORE DELETE ON answers WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_answers'); END;
--> statement-breakpoint
CREATE TRIGGER help_events_immutable_update BEFORE UPDATE ON help_events WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_help_events'); END;
--> statement-breakpoint
CREATE TRIGGER help_events_immutable_delete BEFORE DELETE ON help_events WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_help_events'); END;
--> statement-breakpoint
CREATE TRIGGER feedback_immutable_update BEFORE UPDATE ON feedback WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_feedback'); END;
--> statement-breakpoint
CREATE TRIGGER feedback_immutable_delete BEFORE DELETE ON feedback WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_feedback'); END;
--> statement-breakpoint
CREATE TRIGGER revisions_immutable_update BEFORE UPDATE ON revisions WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_revisions'); END;
--> statement-breakpoint
CREATE TRIGGER revisions_immutable_delete BEFORE DELETE ON revisions WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_revisions'); END;
--> statement-breakpoint
CREATE TRIGGER confirmed_results_immutable_update BEFORE UPDATE ON confirmed_results WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_confirmed_results'); END;
--> statement-breakpoint
CREATE TRIGGER confirmed_results_immutable_delete BEFORE DELETE ON confirmed_results WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_confirmed_results'); END;
--> statement-breakpoint
CREATE TRIGGER corrections_immutable_update BEFORE UPDATE ON corrections WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_corrections'); END;
--> statement-breakpoint
CREATE TRIGGER corrections_immutable_delete BEFORE DELETE ON corrections WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_corrections'); END;
--> statement-breakpoint
CREATE TRIGGER correction_impacts_immutable_update BEFORE UPDATE ON correction_impacts WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_correction_impacts'); END;
--> statement-breakpoint
CREATE TRIGGER correction_impacts_immutable_delete BEFORE DELETE ON correction_impacts WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_correction_impacts'); END;
--> statement-breakpoint
CREATE TRIGGER review_attempts_immutable_update BEFORE UPDATE ON review_attempts WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_review_attempts'); END;
--> statement-breakpoint
CREATE TRIGGER review_attempts_immutable_delete BEFORE DELETE ON review_attempts WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_review_attempts'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_versions_immutable_update BEFORE UPDATE ON weekly_versions WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_weekly_versions'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_versions_immutable_delete BEFORE DELETE ON weekly_versions WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_weekly_versions'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_evidence_immutable_update BEFORE UPDATE ON weekly_evidence WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_weekly_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_evidence_immutable_delete BEFORE DELETE ON weekly_evidence WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_weekly_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER cost_usage_immutable_update BEFORE UPDATE ON cost_usage WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_cost_usage'); END;
--> statement-breakpoint
CREATE TRIGGER cost_usage_immutable_delete BEFORE DELETE ON cost_usage WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_cost_usage'); END;
--> statement-breakpoint
CREATE TRIGGER quota_usage_immutable_update BEFORE UPDATE ON quota_usage WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_quota_usage'); END;
--> statement-breakpoint
CREATE TRIGGER quota_usage_immutable_delete BEFORE DELETE ON quota_usage WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_quota_usage'); END;
--> statement-breakpoint
CREATE TRIGGER atomic_requests_immutable_update BEFORE UPDATE ON atomic_requests WHEN 1 BEGIN SELECT RAISE(ABORT, 'immutable_atomic_requests'); END;
--> statement-breakpoint
CREATE TRIGGER atomic_requests_immutable_delete BEFORE DELETE ON atomic_requests WHEN NOT EXISTS(SELECT 1 FROM verification_runs WHERE owner_id = OLD.owner_id AND owner_id = 'verification:' || id AND state = 'cleaning') BEGIN SELECT RAISE(ABORT, 'immutable_atomic_requests'); END;
--> statement-breakpoint
CREATE TRIGGER page_requires_verified_upload BEFORE INSERT ON material_pages WHEN NOT EXISTS(SELECT 1 FROM uploads WHERE owner_id = NEW.owner_id AND id = NEW.upload_id AND material_id = NEW.material_id AND state = 'verified' AND expected_hash = verified_hash) BEGIN SELECT RAISE(ABORT, 'invalid_unverified_upload'); END;
--> statement-breakpoint
CREATE TRIGGER source_requires_exact_span BEFORE INSERT ON source_references WHEN NOT EXISTS(SELECT 1 FROM material_pages p WHERE p.owner_id = NEW.owner_id AND p.id = NEW.page_id AND p.printed_page IS NEW.printed_page AND NEW.span_end <= length(p.content) AND substr(p.content, NEW.span_start + 1, NEW.span_end - NEW.span_start) = NEW.evidence) BEGIN SELECT RAISE(ABORT, 'invalid_source_span'); END;
--> statement-breakpoint
CREATE TRIGGER session_requires_plan_unit BEFORE INSERT ON sessions WHEN NOT EXISTS(SELECT 1 FROM plan_versions p, json_each(p.content,'$.unitIds') j WHERE p.owner_id = NEW.owner_id AND p.id = NEW.plan_version_id AND j.value = NEW.unit_id) BEGIN SELECT RAISE(ABORT, 'invalid_plan_unit'); END;
--> statement-breakpoint
CREATE TRIGGER attempt_requires_same_unit BEFORE INSERT ON attempts WHEN NEW.original_question_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM questions q JOIN sessions original ON original.owner_id = q.owner_id AND original.id = q.session_id JOIN sessions current ON current.owner_id = original.owner_id AND current.unit_id = original.unit_id WHERE q.owner_id = NEW.owner_id AND q.id = NEW.original_question_id AND current.id = NEW.session_id) BEGIN SELECT RAISE(ABORT, 'invalid_original_question'); END;
--> statement-breakpoint
CREATE TRIGGER help_requires_unsubmitted_attempt BEFORE INSERT ON help_events WHEN EXISTS(SELECT 1 FROM answers WHERE owner_id = NEW.owner_id AND attempt_id = NEW.attempt_id) BEGIN SELECT RAISE(ABORT, 'invalid_help_after_submission'); END;
--> statement-breakpoint
CREATE TRIGGER revision_requires_same_answer BEFORE INSERT ON revisions WHEN NOT EXISTS(SELECT 1 FROM feedback WHERE owner_id = NEW.owner_id AND id = NEW.feedback_id AND answer_id = NEW.answer_id) BEGIN SELECT RAISE(ABORT, 'invalid_revision_answer'); END;
--> statement-breakpoint
CREATE TRIGGER result_pointer_requires_own_version BEFORE UPDATE ON learning_results WHEN NEW.current_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM confirmed_results WHERE owner_id = NEW.owner_id AND id = NEW.current_version_id AND result_id = NEW.id) BEGIN SELECT RAISE(ABORT, 'invalid_result_pointer'); END;
--> statement-breakpoint
CREATE TRIGGER result_requires_answer_context BEFORE INSERT ON confirmed_results WHEN NOT EXISTS(SELECT 1 FROM learning_results r JOIN sessions s ON s.owner_id = r.owner_id AND s.unit_id = r.unit_id JOIN attempts t ON t.owner_id = s.owner_id AND t.session_id = s.id JOIN answers a ON a.owner_id = t.owner_id AND a.attempt_id = t.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.result_id AND r.version = NEW.ordinal AND a.id = NEW.answer_id AND t.status = 'ready' AND a.submitted_at <= NEW.confirmed_at) BEGIN SELECT RAISE(ABORT, 'invalid_result_context'); END;
--> statement-breakpoint
CREATE TRIGGER result_requires_independent_evidence BEFORE INSERT ON confirmed_results WHEN NEW.performance IN ('독립 수행','지연 재현') AND NOT EXISTS(SELECT 1 FROM answers a JOIN attempts t ON t.owner_id = a.owner_id AND t.id = a.attempt_id WHERE a.owner_id = NEW.owner_id AND a.id = NEW.answer_id AND t.hidden_material = 1 AND ((NEW.performance = '독립 수행' AND t.mode = 'new-condition') OR (NEW.performance = '지연 재현' AND t.mode = 'delayed-recall')) AND NOT EXISTS(SELECT 1 FROM help_events h JOIN attempts previous ON previous.owner_id = h.owner_id AND previous.id = h.attempt_id WHERE h.owner_id = t.owner_id AND previous.question_id = t.question_id)) BEGIN SELECT RAISE(ABORT, 'invalid_independence_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER result_requires_delayed_evidence BEFORE INSERT ON confirmed_results WHEN NEW.performance = '지연 재현' AND NOT EXISTS(SELECT 1 FROM confirmed_results earlier WHERE earlier.owner_id = NEW.owner_id AND earlier.result_id = NEW.result_id AND earlier.performance = '독립 수행' AND date(earlier.confirmed_at / 1000,'unixepoch','+9 hours') < date(NEW.confirmed_at / 1000,'unixepoch','+9 hours')) BEGIN SELECT RAISE(ABORT, 'invalid_delayed_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER result_requires_correction_recheck BEFORE INSERT ON confirmed_results WHEN NEW.performance IN ('독립 수행','지연 재현') AND EXISTS(SELECT 1 FROM learning_results r JOIN errors e ON e.owner_id = r.owner_id AND e.unit_id = r.unit_id JOIN review_items v ON v.owner_id = e.owner_id AND v.error_id = e.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.result_id AND v.correction_id IS NOT NULL AND (v.recheck_state = 'required' OR (NEW.performance = '지연 재현' AND v.recheck_state != 'delayed'))) BEGIN SELECT RAISE(ABORT, 'invalid_unchecked_correction'); END;
--> statement-breakpoint
CREATE TRIGGER result_correction_reference BEFORE INSERT ON confirmed_results WHEN NEW.correction_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM corrections c JOIN errors e ON e.owner_id = c.owner_id AND e.id = c.error_id JOIN learning_results r ON r.owner_id = e.owner_id AND r.unit_id = e.unit_id WHERE c.owner_id = NEW.owner_id AND c.id = NEW.correction_id AND r.id = NEW.result_id) BEGIN SELECT RAISE(ABORT, 'invalid_correction_reference'); END;
--> statement-breakpoint
CREATE TRIGGER error_answer_unit BEFORE INSERT ON errors WHEN NOT EXISTS(SELECT 1 FROM answers a JOIN attempts t ON t.owner_id = a.owner_id AND t.id = a.attempt_id JOIN sessions s ON s.owner_id = t.owner_id AND s.id = t.session_id WHERE a.owner_id = NEW.owner_id AND a.id = NEW.answer_id AND s.unit_id = NEW.unit_id) BEGIN SELECT RAISE(ABORT, 'invalid_error_context'); END;
--> statement-breakpoint
CREATE TRIGGER correction_source_course BEFORE INSERT ON corrections WHEN NOT EXISTS(SELECT 1 FROM errors e JOIN units u ON u.owner_id = e.owner_id AND u.id = e.unit_id JOIN source_references ref ON ref.owner_id = e.owner_id AND ref.id = NEW.source_ref_id JOIN materials m ON m.owner_id = ref.owner_id AND m.id = ref.material_id WHERE e.owner_id = NEW.owner_id AND e.id = NEW.error_id AND e.answer_id = NEW.answer_id AND e.concept = NEW.concept AND m.course_id = u.course_id) BEGIN SELECT RAISE(ABORT, 'invalid_correction_source'); END;
--> statement-breakpoint
CREATE TRIGGER review_attempt_evidence BEFORE INSERT ON review_attempts WHEN NOT EXISTS(SELECT 1 FROM review_items r JOIN errors e ON e.owner_id = r.owner_id AND e.id = r.error_id JOIN sessions s ON s.owner_id = e.owner_id AND s.unit_id = e.unit_id JOIN attempts t ON t.owner_id = s.owner_id AND t.session_id = s.id JOIN answers a ON a.owner_id = t.owner_id AND a.attempt_id = t.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.review_id AND r.correction_id IS NEW.correction_id AND a.id = NEW.answer_id AND a.submitted_at <= NEW.performed_at AND t.hidden_material = 1 AND t.status = 'ready' AND ((NEW.kind = 'variable' AND t.mode = 'new-condition') OR (NEW.kind = 'delayed-recall' AND t.mode = 'delayed-recall')) AND NOT EXISTS(SELECT 1 FROM help_events WHERE owner_id = a.owner_id AND attempt_id = a.attempt_id) AND (NEW.correction_id IS NULL OR EXISTS(SELECT 1 FROM corrections c WHERE c.owner_id = r.owner_id AND c.id = NEW.correction_id AND c.study_date <= date(a.submitted_at / 1000,'unixepoch','+9 hours')))) BEGIN SELECT RAISE(ABORT, 'invalid_review_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER review_delayed_evidence BEFORE INSERT ON review_attempts WHEN NEW.kind = 'delayed-recall' AND NOT EXISTS(SELECT 1 FROM review_attempts earlier WHERE earlier.owner_id = NEW.owner_id AND earlier.review_id = NEW.review_id AND earlier.correction_id IS NEW.correction_id AND earlier.kind = 'variable' AND date(earlier.performed_at / 1000,'unixepoch','+9 hours') < date(NEW.performed_at / 1000,'unixepoch','+9 hours')) BEGIN SELECT RAISE(ABORT, 'invalid_delayed_review'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_plan_course BEFORE INSERT ON weekly_versions WHEN NOT EXISTS(SELECT 1 FROM weekly_summaries s JOIN plan_versions p ON p.owner_id = s.owner_id AND p.course_id = s.course_id WHERE s.owner_id = NEW.owner_id AND s.id = NEW.summary_id AND s.version = NEW.ordinal AND p.id = NEW.plan_version_id) BEGIN SELECT RAISE(ABORT, 'invalid_weekly_plan'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_evidence_context BEFORE INSERT ON weekly_evidence WHEN NOT EXISTS(SELECT 1 FROM weekly_versions v JOIN weekly_summaries w ON w.owner_id = v.owner_id AND w.id = v.summary_id JOIN confirmed_results c ON c.owner_id = w.owner_id AND c.id = NEW.result_version_id JOIN learning_results r ON r.owner_id = c.owner_id AND r.id = c.result_id JOIN units u ON u.owner_id = r.owner_id AND u.id = r.unit_id WHERE v.owner_id = NEW.owner_id AND v.id = NEW.weekly_version_id AND u.course_id = w.course_id AND date(c.confirmed_at / 1000,'unixepoch','+9 hours') BETWEEN w.period_start AND w.period_end AND c.correction_id IS NEW.correction_id) BEGIN SELECT RAISE(ABORT, 'invalid_weekly_evidence'); END;
--> statement-breakpoint
CREATE TRIGGER reference_selection_material BEFORE INSERT ON reference_selections WHEN NOT EXISTS(SELECT 1 FROM materials m WHERE m.owner_id = NEW.owner_id AND m.id = NEW.material_id AND m.origin = 'google' AND m.original_id = NEW.external_id AND m.modified_at = NEW.modified_at) BEGIN SELECT RAISE(ABORT, 'invalid_selected_material'); END;
--> statement-breakpoint
CREATE TRIGGER weekly_job_requires_version BEFORE INSERT ON external_jobs WHEN NEW.kind = 'weekly-export' AND NEW.weekly_version_id IS NULL BEGIN SELECT RAISE(ABORT, 'invalid_export_version'); END;
