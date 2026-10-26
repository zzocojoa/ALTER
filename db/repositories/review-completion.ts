import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { instant } from "../../lib/reviews/calendar.ts";
import { confirmedReviewEvidence } from "../../lib/reviews/contracts.ts";
import type { ConfirmedReviewEvidence,IntervalProposal } from "../../lib/reviews/contracts.ts";
import { proposeInterval,unassistedPass } from "../../lib/reviews/schedule.ts";
import { judgeDelayedRecall } from "../../lib/reviews/delayed.ts";
import { currentReviewEvidence,readReviewPlan,reviewPlanGuards,insertReviewProposal } from "./review-policy.ts";
import type { SavedReviewPlan } from "../../lib/reviews/view.ts";
import type { ResultSnapshot } from "./result-draft.ts";
import { guardedUpdate,readStorage,requireInBatch } from "./atomic.ts";

export type ReviewCompletion=Readonly<{plan:SavedReviewPlan;evidence:ConfirmedReviewEvidence;proposal:IntervalProposal;delayed:boolean;resolvesCorrection:boolean;correctedAt:number|null}>;
export async function prepareReviewCompletion(db:D1Database,cmd:Command,snapshot:ResultSnapshot,resultId:string,ordinal:number,now:number):Promise<ReviewCompletion|null> {
  const binding=snapshot.state.review;if(!binding) return null;const date=instant.parse(new Date(now).toISOString());const plan=await readReviewPlan(db,cmd.owner,binding.reviewId,date);
  if(plan.version!==binding.planVersion || plan.reviewVersion!==binding.reviewVersion || plan.proposalId!==binding.proposalId || plan.sessionId!==snapshot.state.id || plan.correctionId!==binding.correctionId || snapshot.official?.currentId!==snapshot.state.start.latest?.resultVersionId) throw domainFailure("version_conflict","review.confirm-current-binding",null);
  const original=currentReviewEvidence(snapshot,resultId,ordinal,now);
  // 결과 확정과 같은 근거를 사용해 문제 ID만 바뀐 재출제를 독립 수행으로 세지 않습니다.
  const validVariation=snapshot.state.question.mode!=="new-condition" || snapshot.draft.judgment.evidence.some(item=>item.sessionId===snapshot.state.id && item.answerId===original.answerId && item.questionId===snapshot.state.question.id && item.kind==="new-condition" && item.accepted);
  const raw={...original,correct:original.correct && validVariation};
  const inherited=plan.task.type==="memory" && snapshot.state.question.mode!=="new-condition" ? plan.evidence.helpIds : [];
  const evidence=confirmedReviewEvidence.parse({...raw,correct:raw.correct && !(plan.correctionId!==null && plan.recheckState==="required" && snapshot.state.question.mode!=="new-condition"),helpIds:[...new Set([...raw.helpIds,...inherited])]});
  const correctedAt=plan.correctionId ? await readStorage("review.correction-time",()=>db.prepare("SELECT created_at FROM corrections WHERE owner_id=? AND id=?").bind(cmd.owner.userId,plan.correctionId).first<number>("created_at")) : null;
  if(plan.correctionId && correctedAt===null) throw domainFailure("reference_conflict","review.correction-time-missing",null);
  const variation=snapshot.state.variations.find((item)=>item.questionId===snapshot.state.question.id);
  const resolvesCorrection=plan.correctionId!==null && unassistedPass(evidence) && snapshot.state.question.mode==="new-condition" && variation!==undefined && evidence.submittedAt>(correctedAt ?? 0);
  const proposal=proposeInterval(plan.proposal.stage,{kind:"confirmed",evidence},plan.proposal.conditions,date,"Asia/Seoul");
  const delayed=judgeDelayedRecall({scheduled:plan.decision.status!=="proposed",kind:binding.kind,dueDate:binding.dueDate,baselineAt:binding.baselineAt,correctedAt,evidence},"Asia/Seoul").confirmed && snapshot.state.question.mode!=="new-condition" && (plan.correctionId===null || plan.recheckState==="independent" || plan.recheckState==="delayed");
  return {plan,evidence,proposal,delayed,resolvesCorrection,correctedAt};
}
export function reviewCompletionGuards(db:D1Database,cmd:Command,completion:ReviewCompletion,sessionId:string,requestId:string):readonly D1PreparedStatement[] {
  const p=completion.plan;return [...reviewPlanGuards(db,cmd,p,requestId,3000),requireInBatch(db,cmd.owner.userId,requestId,3002,"EXISTS(SELECT 1 FROM review_sessions s JOIN review_schedule r ON r.owner_id=s.owner_id AND r.id=s.schedule_id WHERE s.owner_id=? AND s.session_id=? AND s.review_id=? AND s.schedule_id=? AND r.state='pending' AND r.review_version=? AND r.correction_id IS ?)",[cmd.owner.userId,sessionId,p.id,p.proposalId,p.reviewVersion,p.correctionId])];
}
export function correctionRecheckStatements(db:D1Database,cmd:Command,completion:ReviewCompletion,requestId:string,now:number):readonly D1PreparedStatement[] {
  if(!completion.resolvesCorrection && !(completion.delayed && completion.plan.correctionId)) return [];const p=completion.plan;const delayed=completion.delayed && p.correctionId!==null;
  return [...guardedUpdate(db,"review_items",cmd.owner.userId,p.id,p.reviewVersion,requestId,3010,"recheck_state=?",[delayed ? "delayed" : "independent"],"correction_id IS ?",[p.correctionId]),db.prepare("INSERT INTO review_attempts VALUES (?,?,?,?,?,?,?)").bind(cmd.owner.userId,crypto.randomUUID(),p.id,p.correctionId,completion.evidence.answerId,delayed ? "delayed-recall" : "variable",now)];
}
export function reviewCompletionStatements(db:D1Database,cmd:Command,completion:ReviewCompletion,requestId:string,now:number):readonly D1PreparedStatement[] {
  const p=completion.plan;const id=crypto.randomUUID();return [
    ...guardedUpdate(db,"review_schedule",cmd.owner.userId,p.proposalId,1,requestId,3020,"state='complete'",[],"state='pending' AND review_version=?",[p.reviewVersion]),
    ...guardedUpdate(db,"review_plans",cmd.owner.userId,p.id,p.version,requestId,3021,"current_proposal_id=?",[id],"current_proposal_id=?",[p.proposalId]),
    insertReviewProposal(db,cmd.owner,id,p.id,completion.evidence.resultVersionId,p.proposalId,completion.proposal,{status:"proposed",dueDate:completion.proposal.dueDate,reason:completion.proposal.reasons.join(" "),decidedAt:now},p.task,now),
  ];
}
