import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { instant,seoulCalendarDate } from "../../lib/reviews/calendar.ts";
import { reviewBinding } from "../../lib/reviews/contracts.ts";
import { tutorState } from "../../lib/tutor/contracts.ts";
import { initialTutor } from "../../lib/tutor/state.ts";
import { tutorStartContext,startContextIssues } from "../../lib/tutor/start.ts";
import { readCurrentTutorRecord,readCorrectedTutorReviews,readDueTutorReviews } from "./tutor-start.ts";
import { readReviewPlan,reviewPlanGuards } from "./review-policy.ts";
import { getTutor,tutorCreationStatements } from "./tutor.ts";
import { requireCurrentTutor } from "../../lib/tutor/current.ts";
import { executeAtomic,readAtomicReceipt,readStorage,requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export type StartReview=Readonly<{id:string;reviewId:string;expectedVersion:number;questionId:string;attemptId:string}>;
/** 원본 확정 회차의 범위를 재사용하되 최신 결과와 정정을 다시 읽어 새로운 인출 회차를 엽니다. */
export async function startReviewSession(db:D1Database,bucket:R2Bucket,cmd:Command,input:StartReview,now:number):Promise<Receipt> {
  const replay=await readAtomicReceipt(db,cmd,"review.start",input,input.id);if(replay) return replay;
  const date=instant.parse(new Date(now).toISOString());const today=seoulCalendarDate(date,"Asia/Seoul");const plan=await readReviewPlan(db,cmd.owner,input.reviewId,date);
  if(plan.version!==cmd.expectedVersion || input.expectedVersion!==cmd.expectedVersion || plan.decision.status==="proposed" || plan.decision.dueDate>today || plan.sessionId) throw domainFailure("version_conflict","review.accepted-due-schedule-required",null);
  const baseline=await readStorage("review.baseline",()=>db.prepare("SELECT c.session_id AS sessionId,c.confirmed_at AS confirmedAt FROM session_confirmations c WHERE c.owner_id=? AND c.result_version_id=?").bind(cmd.owner.userId,plan.basisResultVersionId).first<{sessionId:string;confirmedAt:number}>());
  const schedule=await readStorage("review.schedule",()=>db.prepare("SELECT kind,review_version AS reviewVersion,correction_id AS correctionId FROM review_schedule WHERE owner_id=? AND id=? AND state='pending'").bind(cmd.owner.userId,plan.proposalId).first<{kind:"variable"|"delayed-recall";reviewVersion:number;correctionId:string|null}>());
  if(!baseline || !schedule || schedule.reviewVersion!==plan.reviewVersion || schedule.correctionId!==plan.correctionId) throw domainFailure("reference_conflict","review.schedule-basis-or-correction-changed",null);
  // 직접 수락한 당일 연습은 허용하되 지연 재현 여부는 실제 제출 날짜로 별도 판정합니다.
  const original=await getTutor(db,cmd.owner,baseline.sessionId);const unit=original.start.bundle.unit;
  const latest=await readCurrentTutorRecord(db,cmd.owner,unit.unitId);const reviews=await readCorrectedTutorReviews(db,cmd.owner,unit.courseId);const due=await readDueTutorReviews(db,cmd.owner,unit.courseId,today);
  const start=tutorStartContext.parse({...original.start,today,latest,reviews,due,issues:startContextIssues(latest,reviews,due)});
  const binding=reviewBinding.parse({reviewId:plan.id,reviewVersion:plan.reviewVersion,planVersion:plan.version,scheduleId:plan.proposalId,proposalId:plan.proposalId,basisResultVersionId:plan.basisResultVersionId,baselineAt:baseline.confirmedAt,dueDate:plan.decision.dueDate,kind:schedule.kind,task:plan.task,correctionId:plan.correctionId});
  const initial=initialTutor(input.id,start,input.questionId,input.attemptId);const question={...initial.question,prompt:plan.task.prompt,sourceRefIds:plan.task.sourceRefIds};
  const state=tutorState.parse({...initial,review:binding,phase:"awaiting-answer",question,questions:[question]});await requireCurrentTutor(db,bucket,cmd.owner,state);
  return executeAtomic(db,cmd,"review.start",input,state.id,1,(requestId)=>[
    ...reviewPlanGuards(db,cmd,plan,requestId,500),requireInBatch(db,cmd.owner.userId,requestId,502,"EXISTS(SELECT 1 FROM review_schedule WHERE owner_id=? AND id=? AND state='pending' AND review_version=? AND correction_id IS ?)",[cmd.owner.userId,plan.proposalId,plan.reviewVersion,plan.correctionId]),
    ...tutorCreationStatements(db,cmd,state,requestId,input),
    ...(schedule.kind==="delayed-recall" ? [db.prepare("UPDATE attempts SET mode='delayed-recall' WHERE owner_id=? AND id=?").bind(cmd.owner.userId,input.attemptId)] : []),
    db.prepare("INSERT INTO review_sessions VALUES (?,?,?,?,?)").bind(cmd.owner.userId,state.id,plan.id,plan.proposalId,JSON.stringify(binding)),
  ]);
}
