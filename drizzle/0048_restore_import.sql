CREATE TABLE `restore_import_pages` (
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`sequence` integer NOT NULL,
	`source_sha256` text NOT NULL,
	`projected_sha256` text NOT NULL,
	`row_count` integer NOT NULL,
	`loaded_at` integer NOT NULL,
	PRIMARY KEY(`run_id`, `path`),
	FOREIGN KEY (`run_id`) REFERENCES `restore_imports`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_import_page_data" CHECK("restore_import_pages"."sequence" BETWEEN 0 AND 9999 AND "restore_import_pages"."row_count" BETWEEN 0 AND 32 AND "restore_import_pages"."loaded_at">=0)
);
--> statement-breakpoint
CREATE TABLE `restore_import_scopes` (
	`slot` integer PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`table_name` text NOT NULL,
	`path` text NOT NULL,
	`source_sha256` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `restore_imports`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_import_scope_slot" CHECK("restore_import_scopes"."slot"=1)
);
--> statement-breakpoint
CREATE TABLE `restore_imports` (
	`run_id` text PRIMARY KEY NOT NULL,
	`manifest_sha256` text NOT NULL,
	`expected_pages` integer NOT NULL,
	`loaded_pages` integer NOT NULL,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `restore_archives`(`run_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "restore_import_progress" CHECK("restore_imports"."expected_pages" BETWEEN 1 AND 10000 AND "restore_imports"."loaded_pages" BETWEEN 0 AND "restore_imports"."expected_pages" AND "restore_imports"."started_at">=0)
);

--> statement-breakpoint
CREATE TRIGGER restore_import_start BEFORE INSERT ON restore_imports
WHEN NEW.loaded_pages<>0 OR NOT EXISTS(SELECT 1 FROM restore_runs r JOIN restore_archives a ON a.run_id=r.id WHERE r.id=NEW.run_id AND r.state='receiving' AND a.state='ready' AND a.manifest_sha256=NEW.manifest_sha256)
BEGIN SELECT RAISE(ABORT,'invalid_restore_import'); END;
--> statement-breakpoint
CREATE TRIGGER restore_import_immutable BEFORE UPDATE ON restore_imports
WHEN NEW.run_id IS NOT OLD.run_id OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256 OR NEW.expected_pages IS NOT OLD.expected_pages OR NEW.started_at IS NOT OLD.started_at OR NEW.loaded_pages<>OLD.loaded_pages+1 OR NOT EXISTS(SELECT 1 FROM restore_import_pages p WHERE p.run_id=OLD.run_id AND p.sequence=OLD.loaded_pages)
BEGIN SELECT RAISE(ABORT,'immutable_restore_import'); END;
--> statement-breakpoint
CREATE UNIQUE INDEX restore_import_sequence ON restore_import_pages(run_id,sequence);
--> statement-breakpoint
CREATE TRIGGER restore_import_scope_insert BEFORE INSERT ON restore_import_scopes
WHEN NOT EXISTS(SELECT 1 FROM restore_runs r JOIN restore_archives a ON a.run_id=r.id JOIN restore_page_receipts p ON p.run_id=r.id JOIN restore_storage s ON s.slot=1 JOIN restore_imports i ON i.run_id=r.id
WHERE r.id=NEW.run_id AND r.owner_id=NEW.owner_id AND r.state='verifying' AND a.state='ready' AND a.manifest_sha256=i.manifest_sha256 AND s.state='ready' AND json_extract(s.identity,'$.purpose')='restore-test' AND json_extract(s.identity,'$.owner.userId')=NEW.owner_id AND p.path=NEW.path AND p.sha256=NEW.source_sha256 AND NEW.path=('pages/'||NEW.table_name||'/'||printf('%06d',CAST(substr(NEW.path,length(NEW.table_name)+8,6) AS INTEGER))||'.json') AND i.loaded_pages<i.expected_pages)
BEGIN SELECT RAISE(ABORT,'invalid_restore_import_scope'); END;
--> statement-breakpoint
CREATE TRIGGER restore_import_page_insert BEFORE INSERT ON restore_import_pages
WHEN NOT EXISTS(SELECT 1 FROM restore_imports i JOIN restore_import_scopes s ON s.run_id=i.run_id WHERE i.run_id=NEW.run_id AND i.loaded_pages=NEW.sequence AND s.path=NEW.path AND s.source_sha256=NEW.source_sha256)
BEGIN SELECT RAISE(ABORT,'invalid_restore_import_page'); END;
--> statement-breakpoint
CREATE TRIGGER restore_imports_no_delete BEFORE DELETE ON restore_imports BEGIN SELECT RAISE(ABORT,'immutable_restore_import'); END;
--> statement-breakpoint
CREATE TRIGGER restore_import_pages_no_delete BEFORE DELETE ON restore_import_pages BEGIN SELECT RAISE(ABORT,'immutable_restore_import'); END;
--> statement-breakpoint
CREATE TRIGGER restore_import_scopes_no_update BEFORE UPDATE ON restore_import_scopes BEGIN SELECT RAISE(ABORT,'immutable_restore_import'); END;
--> statement-breakpoint
CREATE TRIGGER restore_import_pages_no_update BEFORE UPDATE ON restore_import_pages BEGIN SELECT RAISE(ABORT,'immutable_restore_import'); END;
--> statement-breakpoint
DROP TRIGGER ai_call_requires_reserved_dispatch;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER ai_call_requires_reserved_dispatch BEFORE INSERT ON ai_calls WHEN (NEW.stage != 'intent' OR NOT EXISTS(SELECT 1 FROM cost_reservations r JOIN ai_cost_intents i ON i.owner_id = r.owner_id AND i.id = r.id JOIN external_jobs j ON j.owner_id = r.owner_id AND j.id = r.id JOIN external_steps s ON s.owner_id = j.owner_id AND s.job_id = j.id JOIN external_attempts a ON a.owner_id = s.owner_id AND a.step_id = s.id AND a.id = r.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.id AND r.state = 'reserved' AND j.kind = 'ai' AND s.id = NEW.step_id AND s.state = 'leased' AND a.outcome = 'sent')) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='ai_calls') BEGIN SELECT RAISE(ABORT, 'invalid_ai_dispatch'); END;
--> statement-breakpoint
DROP TRIGGER external_attempt_parent;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER external_attempt_parent BEFORE INSERT ON external_attempt_records WHEN (NOT EXISTS(SELECT 1 FROM external_operations WHERE owner_id=NEW.owner_id AND id=NEW.operation_id AND state='running' AND lease_id=NEW.lease_id AND lease_epoch=NEW.lease_epoch AND attempt_count=NEW.ordinal)) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='external_attempt_records') BEGIN SELECT RAISE(ABORT,'external_attempt_wrong_lease'); END;
--> statement-breakpoint
DROP TRIGGER external_conflict_write_block;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER external_conflict_write_block BEFORE INSERT ON external_attempt_records WHEN (NEW.mode='write' AND EXISTS(SELECT 1 FROM external_attempt_records a WHERE a.owner_id=NEW.owner_id AND a.operation_id=NEW.operation_id AND a.state='conflict')) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='external_attempt_records') BEGIN SELECT RAISE(ABORT,'external_conflict_read_only'); END;
--> statement-breakpoint
DROP TRIGGER external_workflow_predecessor;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER external_workflow_predecessor BEFORE INSERT ON external_workflows WHEN ((json_extract(NEW.snapshot,'$.predecessorId') IS NULL AND EXISTS(SELECT 1 FROM external_workflows WHERE owner_id=NEW.owner_id AND kind=NEW.kind AND target_key=NEW.target_key)) OR (json_extract(NEW.snapshot,'$.predecessorId') IS NOT NULL AND NOT EXISTS(SELECT 1 FROM external_workflows w WHERE w.owner_id=NEW.owner_id AND w.id=json_extract(NEW.snapshot,'$.predecessorId') AND w.kind=NEW.kind AND w.target_key=NEW.target_key AND w.google_subject=NEW.google_subject AND w.state='confirmed'))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='external_workflows') BEGIN SELECT RAISE(ABORT,'external_workflow_predecessor_required'); END;
--> statement-breakpoint
DROP TRIGGER google_material_source_proof;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER google_material_source_proof BEFORE INSERT ON google_material_sources WHEN (NOT EXISTS(SELECT 1 FROM google_reference_reads r JOIN material_transfers t ON t.owner_id=r.owner_id WHERE r.owner_id=NEW.owner_id AND r.id=NEW.read_id AND r.state='verified' AND t.id=NEW.transfer_id AND t.material_id=NEW.material_id AND t.state='reserved' AND json_extract(r.proof,'$.sha256')=json_extract(t.metadata,'$.sha256') AND json_extract(r.proof,'$.bytes')=json_extract(t.metadata,'$.bytes') AND json_extract(r.proof,'$.mime')=json_extract(t.metadata,'$.mime') AND json_extract(t.metadata,'$.role')='reference')) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='google_material_sources') BEGIN SELECT RAISE(ABORT,'invalid_google_source_proof'); END;
--> statement-breakpoint
DROP TRIGGER google_report_folder_receipt;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER google_report_folder_receipt BEFORE INSERT ON google_report_folders WHEN (NOT EXISTS(SELECT 1 FROM google_requests q JOIN google_runtime r ON r.owner_id=q.owner_id AND r.connection_id=q.connection_id AND r.generation=q.generation WHERE q.owner_id=NEW.owner_id AND q.id=NEW.id AND q.connection_id=NEW.connection_id AND q.generation=NEW.generation AND q.method='drive.files.create' AND q.state='succeeded' AND q.result_external_id=NEW.external_id AND r.state IN ('active','partial'))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='google_report_folders') BEGIN SELECT RAISE(ABORT,'google_report_folder_receipt_required'); END;
--> statement-breakpoint
DROP TRIGGER help_requires_unsubmitted_attempt;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER help_requires_unsubmitted_attempt BEFORE INSERT ON help_events WHEN (EXISTS(SELECT 1 FROM answers WHERE owner_id = NEW.owner_id AND attempt_id = NEW.attempt_id)) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='help_events') BEGIN SELECT RAISE(ABORT, 'invalid_help_after_submission'); END;
--> statement-breakpoint
DROP TRIGGER material_exposures_require_help;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER material_exposures_require_help BEFORE INSERT ON material_exposures WHEN (NOT EXISTS(SELECT 1 FROM help_events h JOIN attempts a ON a.owner_id=h.owner_id AND a.id=h.attempt_id WHERE h.owner_id=NEW.owner_id AND h.id=NEW.help_event_id AND h.attempt_id=NEW.attempt_id AND h.kind='explanation' AND h.level=3 AND h.shown_at=NEW.shown_at AND a.version=h.ordinal AND a.hidden_material=0 AND a.status='awaiting-answer')) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='material_exposures') BEGIN SELECT RAISE(ABORT,'invalid_material_exposure_help'); END;
--> statement-breakpoint
DROP TRIGGER material_transfer_capacity;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER material_transfer_capacity BEFORE INSERT ON material_transfers WHEN (NOT EXISTS(SELECT 1 FROM material_inventory i WHERE i.owner_id=NEW.owner_id AND i.blocked=0 AND i.checked_at<=NEW.updated_at AND i.valid_until>NEW.updated_at AND i.untracked_bytes + COALESCE((SELECT SUM(u.bytes) FROM material_transfers t JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE t.owner_id=NEW.owner_id AND t.state!='discarded'),0) + json_extract(NEW.metadata,'$.bytes') <= 268435456 AND NOT EXISTS(SELECT 1 FROM material_transfers t WHERE t.owner_id=NEW.owner_id AND t.state NOT IN ('registered','discarded')))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='material_transfers') BEGIN SELECT RAISE(ABORT,'invalid_material_capacity'); END;
--> statement-breakpoint
DROP TRIGGER material_transfer_insert;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER material_transfer_insert BEFORE INSERT ON material_transfers WHEN (NEW.state != 'reserved' OR NEW.write_status != 'not-started' OR NEW.version != 1 OR NEW.object_version IS NOT NULL OR NEW.validation IS NOT NULL OR NOT EXISTS(SELECT 1 FROM uploads u JOIN materials m ON m.owner_id=u.owner_id AND m.id=u.material_id WHERE u.owner_id=NEW.owner_id AND u.id=NEW.id AND u.material_id=NEW.material_id AND u.bytes=json_extract(NEW.metadata,'$.bytes') AND u.expected_hash=json_extract(NEW.metadata,'$.sha256') AND m.title=json_extract(NEW.metadata,'$.title'))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='material_transfers') BEGIN SELECT RAISE(ABORT,'invalid_material_transfer_insert'); END;
--> statement-breakpoint
DROP TRIGGER result_requires_answer_context;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER result_requires_answer_context BEFORE INSERT ON confirmed_results WHEN (NOT EXISTS(SELECT 1 FROM learning_results r JOIN sessions s ON s.owner_id = r.owner_id AND s.unit_id = r.unit_id JOIN attempts t ON t.owner_id = s.owner_id AND t.session_id = s.id JOIN answers a ON a.owner_id = t.owner_id AND a.attempt_id = t.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.result_id AND r.version = NEW.ordinal AND a.id = NEW.answer_id AND t.status = 'ready' AND a.submitted_at <= NEW.confirmed_at)) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='confirmed_results') BEGIN SELECT RAISE(ABORT, 'invalid_result_context'); END;
--> statement-breakpoint
DROP TRIGGER result_requires_correction_recheck;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER result_requires_correction_recheck BEFORE INSERT ON confirmed_results WHEN (NEW.performance IN ('독립 수행','지연 재현') AND EXISTS(SELECT 1 FROM learning_results r JOIN errors e ON e.owner_id = r.owner_id AND e.unit_id = r.unit_id JOIN review_items v ON v.owner_id = e.owner_id AND v.error_id = e.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.result_id AND v.correction_id IS NOT NULL AND (v.recheck_state = 'required' OR (NEW.performance = '지연 재현' AND v.recheck_state != 'delayed')))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='confirmed_results') BEGIN SELECT RAISE(ABORT, 'invalid_unchecked_correction'); END;
--> statement-breakpoint
DROP TRIGGER result_requires_independent_evidence;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER result_requires_independent_evidence BEFORE INSERT ON confirmed_results WHEN (NEW.performance IN ('독립 수행','지연 재현') AND NOT EXISTS(SELECT 1 FROM answers a JOIN attempts t ON t.owner_id = a.owner_id AND t.id = a.attempt_id WHERE a.owner_id = NEW.owner_id AND a.id = NEW.answer_id AND t.hidden_material = 1 AND ((NEW.performance = '독립 수행' AND t.mode = 'new-condition') OR (NEW.performance = '지연 재현' AND t.mode = 'delayed-recall')) AND NOT EXISTS(SELECT 1 FROM help_events h JOIN attempts previous ON previous.owner_id = h.owner_id AND previous.id = h.attempt_id WHERE h.owner_id = t.owner_id AND previous.question_id = t.question_id))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='confirmed_results') BEGIN SELECT RAISE(ABORT, 'invalid_independence_evidence'); END;
--> statement-breakpoint
DROP TRIGGER result_requires_new_answer;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER result_requires_new_answer BEFORE INSERT ON confirmed_results WHEN (NEW.performance IN ('독립 수행','지연 재현') AND EXISTS(SELECT 1 FROM learning_results r JOIN errors e ON e.owner_id = r.owner_id AND e.unit_id = r.unit_id JOIN corrections c ON c.owner_id = e.owner_id AND c.error_id = e.id JOIN answers a ON a.owner_id = c.owner_id AND a.id = NEW.answer_id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.result_id AND (c.created_at IS NULL OR a.submitted_at <= c.created_at))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='confirmed_results') BEGIN SELECT RAISE(ABORT, 'invalid_old_confirmed_answer'); END;
--> statement-breakpoint
DROP TRIGGER review_attempt_evidence;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER review_attempt_evidence BEFORE INSERT ON review_attempts WHEN (NOT EXISTS(SELECT 1 FROM review_items r JOIN errors e ON e.owner_id = r.owner_id AND e.id = r.error_id JOIN sessions s ON s.owner_id = e.owner_id AND s.unit_id = e.unit_id JOIN attempts t ON t.owner_id = s.owner_id AND t.session_id = s.id JOIN answers a ON a.owner_id = t.owner_id AND a.attempt_id = t.id WHERE r.owner_id = NEW.owner_id AND r.id = NEW.review_id AND r.correction_id IS NEW.correction_id AND a.id = NEW.answer_id AND a.submitted_at <= NEW.performed_at AND t.hidden_material = 1 AND t.status = 'ready' AND ((NEW.kind = 'variable' AND t.mode = 'new-condition') OR (NEW.kind = 'delayed-recall' AND t.mode = 'delayed-recall')) AND NOT EXISTS(SELECT 1 FROM help_events WHERE owner_id = a.owner_id AND attempt_id = a.attempt_id) AND (NEW.correction_id IS NULL OR EXISTS(SELECT 1 FROM corrections c WHERE c.owner_id = r.owner_id AND c.id = NEW.correction_id AND c.study_date <= date(a.submitted_at / 1000,'unixepoch','+9 hours'))))) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='review_attempts') BEGIN SELECT RAISE(ABORT, 'invalid_review_evidence'); END;
--> statement-breakpoint
DROP TRIGGER review_plan_evidence;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER review_plan_evidence BEFORE INSERT ON review_plans WHEN (NOT EXISTS(
 SELECT 1 FROM confirmed_results c JOIN session_confirmations sc ON sc.owner_id=c.owner_id AND sc.result_version_id=c.id JOIN result_review_targets rt ON rt.owner_id=c.owner_id AND rt.result_version_id=c.id JOIN review_items r ON r.owner_id=rt.owner_id AND r.id=rt.review_id JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN answers a ON a.owner_id=e.owner_id AND a.id=e.answer_id JOIN attempts t ON t.owner_id=a.owner_id AND t.id=a.attempt_id
 WHERE c.owner_id=NEW.owner_id AND r.id=NEW.id AND c.id=json_extract(NEW.evidence,'$.resultVersionId') AND c.ordinal=json_extract(NEW.evidence,'$.resultOrdinal') AND a.id=json_extract(NEW.evidence,'$.answerId') AND a.ordinal=json_extract(NEW.evidence,'$.answerVersion') AND t.question_id=json_extract(NEW.evidence,'$.questionId') AND rt.answer_id=a.id AND json_array_length(NEW.evidence,'$.helpIds')=(SELECT count(*) FROM help_events h JOIN attempts p ON p.owner_id=h.owner_id AND p.id=h.attempt_id WHERE p.owner_id=t.owner_id AND p.question_id=t.question_id) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence,'$.helpIds') h WHERE NOT EXISTS(SELECT 1 FROM help_events e JOIN attempts p ON p.owner_id=e.owner_id AND p.id=e.attempt_id WHERE e.owner_id=t.owner_id AND e.id=h.value AND p.question_id=t.question_id)) AND NOT EXISTS(SELECT 1 FROM json_each(NEW.evidence,'$.sourceRefIds') s WHERE NOT EXISTS(SELECT 1 FROM source_references r WHERE r.owner_id=NEW.owner_id AND r.id=s.value)) AND EXISTS(SELECT 1 FROM json_each(NEW.evidence,'$.sourceRefIds') s WHERE s.value=r.source_ref_id)
)) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='review_plans') BEGIN SELECT RAISE(ABORT,'invalid_review_official_evidence'); END;
--> statement-breakpoint
DROP TRIGGER weekly_plan_course;
--> statement-breakpoint
-- 승인된 한 페이지 적재 범위에서만 신규 기록의 시간 조건을 제외합니다.
CREATE TRIGGER weekly_plan_course BEFORE INSERT ON weekly_versions WHEN (NOT EXISTS(SELECT 1 FROM weekly_summaries s JOIN plan_versions p ON p.owner_id = s.owner_id AND p.course_id = s.course_id WHERE s.owner_id = NEW.owner_id AND s.id = NEW.summary_id AND s.version = NEW.ordinal AND p.id = NEW.plan_version_id)) AND NOT EXISTS(SELECT 1 FROM restore_import_scopes WHERE slot=1 AND owner_id=NEW.owner_id AND table_name='weekly_versions') BEGIN SELECT RAISE(ABORT, 'invalid_weekly_plan'); END;
