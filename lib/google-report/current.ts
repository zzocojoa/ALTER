/** 외부 작업 j의 최신 확정본 여부를 D1에서 다시 검사하며 과거 저장 계층 시험용 null 참조는 유지합니다. */
export const currentWeeklyExportSql:string=`(j.kind!='weekly-export' OR j.weekly_version_id IS NULL OR EXISTS(
  SELECT 1 FROM weekly_snapshots p JOIN weekly_versions v ON v.owner_id=p.owner_id AND v.id=p.id
  JOIN weekly_summaries s ON s.owner_id=v.owner_id AND s.id=v.summary_id
  JOIN weekly_drafts d ON d.owner_id=s.owner_id AND d.summary_id=s.id
  WHERE p.owner_id=j.owner_id AND p.id=j.weekly_version_id AND p.export_job_id=j.id
  AND json_extract(d.content,'$.phase')='confirmed' AND json_extract(d.content,'$.confirmedVersionId')=p.id
  AND NOT EXISTS(SELECT 1 FROM weekly_versions later JOIN weekly_summaries other ON other.owner_id=later.owner_id AND other.id=later.summary_id WHERE later.owner_id=p.owner_id AND other.course_id=s.course_id AND other.period_start=s.period_start AND later.id!=p.id AND later.confirmed_at>=p.confirmed_at)
))`;
