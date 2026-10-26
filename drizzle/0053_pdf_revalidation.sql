-- 새 제약을 먼저 설치하여 중간 실패에도 기존 제약을 유지합니다.
CREATE TRIGGER material_transfer_transition_pdf_revalidation BEFORE UPDATE ON material_transfers WHEN NOT (
 (OLD.state='reserved' AND NEW.state IN ('transferring','cleaning')) OR
 (OLD.state='transferring' AND NEW.state IN ('transferring','stored','unknown','failed')) OR
 (OLD.state='unknown' AND NEW.state IN ('unknown','stored','failed')) OR
 (OLD.state='stored' AND NEW.state IN ('validating','failed','cleaning')) OR
 (OLD.state='validating' AND NEW.state IN ('validating','verified','failed','cleaning')) OR
 (OLD.state='verified' AND NEW.state IN ('registered','cleaning')) OR
 (OLD.state='failed' AND (NEW.state='cleaning' OR (
  NEW.state='validating' AND OLD.write_status='succeeded' AND OLD.validation IS NULL
  AND OLD.object_version IS NOT NULL AND OLD.etag IS NOT NULL
  AND OLD.actual_bytes=json_extract(OLD.metadata,'$.bytes') AND OLD.actual_hash=json_extract(OLD.metadata,'$.sha256')
  AND ((json_extract(OLD.metadata,'$.mime')='image/jpeg'
   AND (OLD.failure_code='content-or-object-invalid' OR OLD.failure_code GLOB 'material_content_invalid:jpeg:*'))
   OR (json_extract(OLD.metadata,'$.mime')='application/pdf' AND OLD.failure_code GLOB 'material_content_invalid:pdf:*'))
 ))) OR
 (OLD.state='cleaning' AND NEW.state IN ('cleaning','discarded'))
) BEGIN SELECT RAISE(ABORT,'invalid_material_transfer_transition'); END;
--> statement-breakpoint
DROP TRIGGER material_transfer_transition_revalidation;
