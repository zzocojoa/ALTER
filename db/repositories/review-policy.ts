import { savedReviewPlan } from "../../lib/reviews/view.ts";
import type { SavedReviewPlan } from "../../lib/reviews/view.ts";
import { readResultSnapshot } from "./result-draft.ts";
import { z } from "zod";
import { domainFailure,recordId,siteIdentity } from "../../lib/domain/contracts.ts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts.ts";
import { errorEvidence,intervalProposal,proposalDecision,confirmedReviewEvidence } from "../../lib/reviews/contracts.ts";
import type { ErrorEvidence,ReviewTask,IntervalProposal,ConfirmedReviewEvidence } from "../../lib/reviews/contracts.ts";
import { makeReviewTask } from "../../lib/reviews/contracts.ts";
import { instant,seoulCalendarDate } from "../../lib/reviews/calendar.ts";
import type { Instant,SeoulTimezone } from "../../lib/reviews/calendar.ts";
import { proposeInterval } from "../../lib/reviews/schedule.ts";
import type { ResultSnapshot } from "./result-draft.ts";
import { executeAtomic,guardedUpdate,readAtomicReceipt,readStorage,requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

export type InitialReviewPlan=Readonly<{evidence:ErrorEvidence;task:ReviewTask;proposal:IntervalProposal}>;
export function initialReviewPlan(snapshot:ResultSnapshot,resultVersionId:string,resultOrdinal:number,answerId:string,criterion:string,now:number):InitialReviewPlan {
  const state=snapshot.states.find((item)=>item.answers.some((answer)=>answer.id===answerId));const answer=state?.answers.find((item)=>item.id===answerId);const fact=snapshot.facts.find((item)=>item.id===answerId);const question=state?.questions.find((item)=>item.id===answer?.questionId);
  if(!state || !answer || !fact || !question) throw domainFailure("reference_conflict","review.confirmed-answer-lineage",null);
  const diagnosis=state.diagnoses.findLast((item)=>item.answerId===answerId);
  return {evidence:errorEvidence.parse({resultVersionId,resultOrdinal,questionId:question.id,answerId,answerVersion:fact.version,sourceRefIds:question.sourceRefIds,helpIds:JSON.parse(fact.helpIds),concept:state.start.bundle.unit.title,feedback:diagnosis?.observation ?? criterion,cause:{status:"unverified"}}),task:makeReviewTask("concept",criterion,question.id,question.prompt,question.sourceRefIds),proposal:proposeInterval(0,{kind:"initial"},{goalDate:null,retentionDays:30,availableMinutes:state.start.bundle.availableMinutes,requiredMinutes:10},instant.parse(new Date(now).toISOString()),"Asia/Seoul")};
}
export function createReviewPolicyStatements(db:D1Database,cmd:Command,reviewId:string,plan:InitialReviewPlan,requestId:string,now:number):readonly D1PreparedStatement[] {
  const proposalId=crypto.randomUUID();return [
    db.prepare("INSERT INTO review_plans VALUES (?,?,1,?,?,?,?)").bind(cmd.owner.userId,reviewId,requestId,JSON.stringify(plan.evidence),JSON.stringify(plan.task),proposalId),
    insertReviewProposal(db,cmd.owner,proposalId,reviewId,plan.evidence.resultVersionId,null,plan.proposal,{status:"proposed",dueDate:plan.proposal.dueDate,reason:"개념 설명 과제로 제안했어요. 학습 유형·기간·시간과 날짜를 확인한 뒤 수락하거나 변경하세요.",decidedAt:now},plan.task,now),
  ];
}
export function insertReviewProposal(db:D1Database,owner:SiteIdentity,id:string,reviewId:string,resultId:string,previousId:string|null,proposal:IntervalProposal,decision:z.infer<typeof proposalDecision>,task:ReviewTask,now:number):D1PreparedStatement {
  return db.prepare("INSERT INTO review_proposals VALUES (?,?,?,?,?,?,?,?)").bind(owner.userId,id,reviewId,resultId,previousId,JSON.stringify({interval:proposal,task}),JSON.stringify(decision),now);
}
export async function readReviewPlans(db:D1Database,owner:SiteIdentity,now:Instant,timezone:SeoulTimezone):Promise<readonly SavedReviewPlan[]> {
  siteIdentity.parse(owner);const today=seoulCalendarDate(now,timezone);
  const rows=await readStorage("review.list",()=>db.prepare(`SELECT p.id,p.version,r.version AS reviewVersion,r.error_id AS errorId,e.version AS errorVersion,r.source_ref_id AS sourceRefId,e.unit_id AS unitId,u.title,r.question,r.explanation,r.next_action AS nextAction,r.correction_id AS correctionId,r.recheck_state AS recheckState,p.evidence,p.task,p.current_proposal_id AS proposalId,v.basis_result_version_id AS basisResultVersionId,v.proposal,v.decision,s.state AS scheduleState,(SELECT session_id FROM review_sessions WHERE owner_id=p.owner_id AND schedule_id=s.id) AS sessionId,(SELECT json_extract(t.state,'$.phase') FROM review_sessions x JOIN tutor_sessions t ON t.owner_id=x.owner_id AND t.id=x.session_id WHERE x.owner_id=p.owner_id AND x.schedule_id=s.id) AS sessionPhase FROM review_plans p JOIN review_items r ON r.owner_id=p.owner_id AND r.id=p.id JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id JOIN units u ON u.owner_id=e.owner_id AND u.id=e.unit_id JOIN review_proposals v ON v.owner_id=p.owner_id AND v.id=p.current_proposal_id LEFT JOIN review_schedule s ON s.owner_id=p.owner_id AND s.id=v.id WHERE p.owner_id=? ORDER BY r.rowid DESC LIMIT 201`).bind(owner.userId).all());
  if(rows.results.length>200) throw domainFailure("limit_exceeded","review.list-requires-narrowing",null);
  return rows.results.map((row)=>{const raw=z.object({evidence:z.string(),task:z.string(),proposal:z.string(),decision:z.string(),scheduleState:z.string().nullable()}).passthrough().parse(row);const proposal=intervalProposal.parse(JSON.parse(raw.proposal).interval);const decision=proposalDecision.parse(JSON.parse(raw.decision));const {scheduleState,...fields}=raw;return savedReviewPlan.parse({...fields,evidence:JSON.parse(raw.evidence),task:JSON.parse(raw.task),proposal,decision,dueState:scheduleState==="complete" ? "complete" : row.correctionId!==null && row.recheckState==="required" ? "recheck" : decision.status==="proposed" ? "proposed" : decision.dueDate<today ? "overdue" : decision.dueDate===today ? "today" : "future"});});
}
export async function readReviewPlan(db:D1Database,owner:SiteIdentity,id:string,now:Instant):Promise<SavedReviewPlan> {
  recordId.parse(id);const plan=(await readReviewPlans(db,owner,now,"Asia/Seoul")).find((item)=>item.id===id);if(!plan) throw domainFailure("reference_conflict","review.owner-plan",null);return plan;
}
export function reviewPlanGuards(db:D1Database,cmd:Command,plan:SavedReviewPlan,requestId:string,step:number):readonly D1PreparedStatement[] {
  return [requireInBatch(db,cmd.owner.userId,requestId,step,"EXISTS(SELECT 1 FROM review_plans WHERE owner_id=? AND id=? AND version=? AND current_proposal_id=?)",[cmd.owner.userId,plan.id,plan.version,plan.proposalId]),requireInBatch(db,cmd.owner.userId,requestId,step+1,"EXISTS(SELECT 1 FROM review_items WHERE owner_id=? AND id=? AND version=? AND correction_id IS ?)",[cmd.owner.userId,plan.id,plan.reviewVersion,plan.correctionId])];
}
export type ReviewChoice=Readonly<{id:string;expectedVersion:number;type:ReviewTask["type"];conditions:IntervalProposal["conditions"];dueDate:string;reason:string}>;
export async function chooseReviewSchedule(db:D1Database,cmd:Command,input:ReviewChoice,now:number):Promise<Receipt> {
  const replay=await readAtomicReceipt(db,cmd,"review.choose",input,input.id);if(replay) return replay;
  const plan=await readReviewPlan(db,cmd.owner,input.id,instant.parse(new Date(now).toISOString()));if(plan.version!==cmd.expectedVersion || input.expectedVersion!==cmd.expectedVersion || plan.sessionId && plan.sessionPhase!=="finished") throw domainFailure("version_conflict","review.schedule-already-started-or-changed",null);
  const task=makeReviewTask(input.type,plan.correctionId ? plan.question : plan.task.criterion,plan.task.originalQuestionId,plan.task.originalPrompt,plan.task.sourceRefIds);
  const proposal=proposeInterval(plan.proposal.stage,{kind:"not-submitted"},input.conditions,instant.parse(`${plan.proposal.anchorDate}T00:00:00+09:00`),"Asia/Seoul");
  const decision=proposalDecision.parse({status:input.dueDate===plan.proposal.dueDate && input.type===plan.task.type && JSON.stringify(input.conditions)===JSON.stringify(plan.proposal.conditions) ? "accepted" : "changed",dueDate:input.dueDate,reason:input.reason,decidedAt:now});
  if(proposal.needsTime || decision.dueDate<seoulCalendarDate(instant.parse(new Date(now).toISOString()),"Asia/Seoul")) throw domainFailure("validation","review.time-or-past-date",null);
  const id=crypto.randomUUID();const kind=await readStorage("review.kind",()=>db.prepare("SELECT CASE WHEN json_extract(sc.judgment,'$.unitPassed')=1 THEN 'delayed-recall' ELSE 'variable' END AS kind FROM session_confirmations sc WHERE sc.owner_id=? AND sc.result_version_id=?").bind(cmd.owner.userId,plan.basisResultVersionId).first<string>("kind"));if(!kind) throw domainFailure("reference_conflict","review.official-target-required",null);
  return executeAtomic(db,cmd,"review.choose",input,input.id,cmd.expectedVersion+1,(requestId)=>[
    ...reviewPlanGuards(db,cmd,plan,requestId,10),
    ...guardedUpdate(db,"review_plans",cmd.owner.userId,plan.id,cmd.expectedVersion,requestId,0,"current_proposal_id=?,task=?",[id,JSON.stringify(task)],"current_proposal_id=?",[plan.proposalId]),
    insertReviewProposal(db,cmd.owner,id,plan.id,plan.basisResultVersionId,plan.proposalId,{...proposal,outcome:plan.proposal.outcome,evidence:plan.proposal.evidence,reasons:[...proposal.reasons,...(decision.dueDate!==proposal.dueDate ? ["사용자가 제안과 다른 날짜를 선택했으며 변경 이유를 별도로 보존해요."] : [])]},decision,task,now),
    db.prepare("INSERT INTO review_schedule VALUES (?,?,1,?,?,?,?,?,?,?,?, 'pending')").bind(cmd.owner.userId,id,requestId,plan.id,plan.reviewVersion,plan.evidence.questionId,plan.basisResultVersionId,plan.correctionId,decision.dueDate,kind==="delayed-recall" && (plan.correctionId===null || plan.recheckState!=="required") ? "delayed-recall" : "variable"),
  ]);
}
export function currentReviewEvidence(snapshot:ResultSnapshot,resultVersionId:string,ordinal:number,now:number):ConfirmedReviewEvidence {
  const state=snapshot.state;const answer=state.answers.find((a)=>a.id===state.currentAnswerId);const fact=snapshot.facts.find((a)=>a.id===answer?.id);const diagnosis=state.diagnoses.findLast((d)=>d.answerId===answer?.id);
  if(!answer || !fact || !diagnosis || !fact.answerEventVersion || !fact.diagnosisVersion) throw domainFailure("reference_conflict","review.saved-answer-evaluation-required",null);
  return confirmedReviewEvidence.parse({status:"confirmed",resultVersionId,resultOrdinal:ordinal,answerId:answer.id,submittedAt:answer.submittedAt,confirmedAt:now,correct:diagnosis.correct===true && diagnosis.readability==="readable" && !diagnosis.needsHelp,hidden:fact.hidden===1 && fact.exposureVersion!==null && fact.exposureVersion<fact.answerEventVersion,helpIds:JSON.parse(fact.helpIds),exposed:answer.helped,firstAttempt:!state.answers.some((a)=>a.id!==answer.id && a.questionId===answer.questionId && a.submittedAt<=answer.submittedAt),evaluation:diagnosis.observation});
}

export async function prepareExistingReview(db:D1Database,cmd:Command,reviewId:string,now:number):Promise<Receipt> {
  const input={reviewId:recordId.parse(reviewId)};const replay=await readAtomicReceipt(db,cmd,"review.prepare-existing",input,reviewId);if(replay) return replay;
  const target=await readStorage("review.existing-target",()=>db.prepare("SELECT t.result_version_id AS resultVersionId,t.answer_id AS answerId,c.ordinal,c.confirmed_at AS confirmedAt,s.session_id AS sessionId,r.question,r.version FROM result_review_targets t JOIN confirmed_results c ON c.owner_id=t.owner_id AND c.id=t.result_version_id JOIN session_confirmations s ON s.owner_id=c.owner_id AND s.result_version_id=c.id JOIN review_items r ON r.owner_id=t.owner_id AND r.id=t.review_id WHERE t.owner_id=? AND t.review_id=?").bind(cmd.owner.userId,reviewId).first<{resultVersionId:string;answerId:string;ordinal:number;confirmedAt:number;sessionId:string;question:string;version:number}>());
  if(!target || target.version!==cmd.expectedVersion) throw domainFailure("reference_conflict","review.existing-official-target",null);
  const snapshot=await readResultSnapshot(db,cmd.owner,target.sessionId);const plan=initialReviewPlan(snapshot,target.resultVersionId,target.ordinal,target.answerId,target.question,target.confirmedAt);
  return executeAtomic(db,cmd,"review.prepare-existing",input,reviewId,1,(requestId)=>[requireInBatch(db,cmd.owner.userId,requestId,0,"NOT EXISTS(SELECT 1 FROM review_plans WHERE owner_id=? AND id=?) AND EXISTS(SELECT 1 FROM review_items WHERE owner_id=? AND id=? AND version=?)",[cmd.owner.userId,reviewId,cmd.owner.userId,reviewId,cmd.expectedVersion]),...createReviewPolicyStatements(db,cmd,reviewId,plan,requestId,now)]);
}
