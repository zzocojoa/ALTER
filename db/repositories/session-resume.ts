import { z } from "zod";
import { domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { tutorState } from "../../lib/tutor/contracts.ts";
import type { TutorState } from "../../lib/tutor/contracts.ts";
import { currentLearningRecord,correctedReview } from "../../lib/tutor/start.ts";
import type { CurrentLearningRecord,CorrectedReview } from "../../lib/tutor/start.ts";
import { readStorage } from "./atomic.ts";
import { requireTutorViewAccess } from "./tutor.ts";
export type ResumeRecord=Readonly<{state:TutorState;latest:CurrentLearningRecord|null;reviews:readonly CorrectedReview[]}>;
/** 상태·최신 결과·정정된 복습을 같은 SQL 스냅샷에서 읽으며 브라우저 저장소를 사용하지 않습니다. */
export async function readSessionResume(db:D1Database,owner:SiteIdentity,id:string):Promise<ResumeRecord> {
  recordId.parse(id);await requireTutorViewAccess(db,owner,id);
  const row=await readStorage("session.resume",()=>db.prepare(`SELECT t.state,(SELECT count(*) FROM attempts a WHERE a.owner_id=t.owner_id AND a.session_id!=t.id AND a.hidden_material=1 AND a.status='awaiting-answer') AS hiddenOther,
    (SELECT json_object('resultVersionId',c.id,'unitId',r.unit_id,'progress',c.progress,'performance',c.performance,'correctionId',c.correction_id,'nextAction',n.next_action) FROM learning_results r JOIN confirmed_results c ON c.owner_id=r.owner_id AND c.id=r.current_version_id LEFT JOIN result_next_actions n ON n.owner_id=c.owner_id AND n.result_version_id=c.id WHERE r.owner_id=s.owner_id AND r.unit_id=s.unit_id) AS latest,
    (SELECT json_group_array(json_object('id',v.id,'unitId',e.unit_id,'version',v.version,'sourceRefId',v.source_ref_id,'correctionId',v.correction_id,'recheckState',v.recheck_state,'question',v.question,'nextAction',v.next_action)) FROM review_items v JOIN errors e ON e.owner_id=v.owner_id AND e.id=v.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id WHERE v.owner_id=s.owner_id AND u.course_id=s.course_id ORDER BY v.id) AS reviews
    FROM tutor_sessions t JOIN sessions s ON s.owner_id=t.owner_id AND s.id=t.id WHERE t.owner_id=? AND t.id=?`).bind(owner.userId,id).first());
  if(!row) throw domainFailure("reference_conflict","session.resume-owner",null);
  const value=z.object({state:z.string(),hiddenOther:z.number().int().nonnegative(),latest:z.string().nullable(),reviews:z.string()}).strict().parse(row);
  if(value.hiddenOther>0) throw domainFailure("reference_conflict","session.resume-other-hidden-recall",null);
  return {state:tutorState.parse(JSON.parse(value.state)),latest:value.latest===null ? null : currentLearningRecord.parse(JSON.parse(value.latest)),reviews:z.array(correctedReview).max(200).parse(JSON.parse(value.reviews))};
}
