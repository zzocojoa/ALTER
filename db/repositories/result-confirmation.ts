import { prepareReviewCompletion,reviewCompletionGuards,correctionRecheckStatements,reviewCompletionStatements } from "./review-completion.ts";
import { initialReviewPlan,createReviewPolicyStatements } from "./review-policy.ts";
import { domainFailure,recordId } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { tutorState } from "../../lib/tutor/contracts.ts";
import { resultRequest } from "../../lib/results/contracts.ts";
import type { ResultRequest } from "../../lib/results/contracts.ts";
import { readResultSnapshot } from "./result-draft.ts";
import type { ResultSnapshot } from "./result-draft.ts";
import { executeAtomic,guardedUpdate,readAtomicReceipt,requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { currentUnitGuard,currentSourceGuard } from "./librarian-links.ts";

function snapshotGuards(db:D1Database,cmd:Command,snapshot:ResultSnapshot,requestId:string):readonly D1PreparedStatement[] {
  const owner=cmd.owner.userId;const unit=snapshot.state.start.bundle.unit;
  const usedStates=snapshot.states.filter((state)=>state.id===snapshot.state.id || snapshot.draft.judgment.evidence.some((evidence)=>evidence.accepted && evidence.sessionId===state.id));
  const sources=[...new Map(usedStates.flatMap((state)=>state.start.bundle.sources).map((source)=>[source.id,source])).values()];
  return [
    requireInBatch(db,owner,requestId,100,"(SELECT count(*) FROM tutor_sessions t JOIN sessions s ON s.owner_id=t.owner_id AND s.id=t.id WHERE t.owner_id=? AND s.unit_id=?)=?",[owner,unit.unitId,snapshot.states.length]),
    ...snapshot.states.map((state,index)=>requireInBatch(db,owner,requestId,101+index,"EXISTS(SELECT 1 FROM tutor_sessions WHERE owner_id=? AND id=? AND version=?)",[owner,state.id,state.version])),
    ...snapshot.facts.map((fact,index)=>requireInBatch(db,owner,requestId,300+index,"EXISTS(SELECT 1 FROM attempts WHERE owner_id=? AND id=? AND version=? AND hidden_material=? AND status=?)",[owner,fact.attemptId,fact.attemptVersion,fact.hidden,fact.status])),
    requireInBatch(db,owner,requestId,2400,"(SELECT count(*) FROM help_events h JOIN attempts a ON a.owner_id=h.owner_id AND a.id=h.attempt_id JOIN sessions s ON s.owner_id=a.owner_id AND s.id=a.session_id WHERE h.owner_id=? AND s.unit_id=?)=?",[owner,unit.unitId,snapshot.helpCount]),
    requireInBatch(db,owner,requestId,2401,"(SELECT count(*) FROM review_items r JOIN errors e ON e.owner_id=r.owner_id AND e.id=r.error_id WHERE r.owner_id=? AND e.unit_id=?)=?",[owner,unit.unitId,snapshot.reviews.length]),
    ...snapshot.reviews.map((review,index)=>requireInBatch(db,owner,requestId,2500+index,"EXISTS(SELECT 1 FROM review_items WHERE owner_id=? AND id=? AND version=? AND correction_id IS ?)",[owner,review.id,review.version,review.correctionId])),
    currentUnitGuard(db,cmd.owner,unit,requestId,2800),...sources.map((source,index)=>currentSourceGuard(db,cmd.owner,source,requestId,2801+index)),
  ];
}
function reviewTargets(db:D1Database,cmd:Command,snapshot:ResultSnapshot,resultVersionId:string,answerId:string,resultOrdinal:number,requestId:string,now:number):readonly D1PreparedStatement[] {
  const {state,draft}=snapshot;const judgment=draft.judgment;const unit=state.start.bundle.unit;
  const kinds:readonly ("self-explanation"|"variable"|"delayed-recall")[]=judgment.unitPassed ? ["delayed-recall"] : [...(!judgment.explanation ? ["self-explanation" as const] : []),...(!judgment.variation ? ["variable" as const] : [])];
  return kinds.flatMap((kind)=>{const errorId=crypto.randomUUID();const reviewId=crypto.randomUUID();const question=kind==="self-explanation" ? unit.selfExplanationCriterion : kind==="variable" ? unit.newConditionCriterion : "다른 학습일에 자료 없이 다시 설명하고 풀어 보세요.";
    const policy=initialReviewPlan(snapshot,resultVersionId,resultOrdinal,answerId,question,now);
    return [db.prepare("INSERT INTO errors VALUES (?,?,1,?,?,?,?,?)").bind(cmd.owner.userId,errorId,requestId,unit.unitId,answerId,unit.title,question),db.prepare("INSERT INTO review_items VALUES (?,?,1,?,?,?,?,?,?,NULL,'required')").bind(cmd.owner.userId,reviewId,requestId,errorId,policy.evidence.sourceRefIds[0],question,judgment.nextAction,judgment.nextAction),db.prepare("INSERT INTO result_review_targets VALUES (?,?,?,?,?,?,?)").bind(cmd.owner.userId,crypto.randomUUID(),resultVersionId,reviewId,answerId,kind,JSON.stringify({basisResultVersionId:resultVersionId,reviewVersion:1,correctionId:null,supersedesResultVersionId:snapshot.official?.currentId ?? null,delayedRecall:judgment.delayedRecall,nextAction:judgment.nextAction})),...createReviewPolicyStatements(db,cmd,reviewId,policy,requestId,now)];
  });
}
/** 중복 요청 확인을 선행하고 회차·수행·복습·영수증을 하나의 원자적 배치로 확정합니다. */
export async function confirmSessionResult(db:D1Database,cmd:Command,value:ResultRequest,now:number):Promise<Receipt> {
  const input=resultRequest.parse(value);if(cmd.expectedVersion!==input.expectedVersion) throw domainFailure("validation","result.command-version",null);
  const replay=await readAtomicReceipt(db,cmd,"session.confirm",input,input.id);if(replay) return replay;
  const snapshot=await readResultSnapshot(db,cmd.owner,input.id);const {state,draft}=snapshot;
  if(!draft.canConfirm || draft.version!==input.expectedVersion || snapshot.sessionVersion!==input.expectedSessionVersion || draft.officialVersion!==input.expectedOfficialVersion || draft.fingerprint!==input.fingerprint) throw domainFailure("version_conflict","result.review-latest-saved-evidence",null);
  const answerId=draft.judgment.performance==="지연 재현" ? snapshot.delayed[0]?.answerId : draft.judgment.variation?.answerId ?? state.currentAnswerId;if(!answerId) throw domainFailure("reference_conflict","result.saved-answer-required",null);
  const resultId=snapshot.official?.id ?? crypto.randomUUID();const resultVersionId=crypto.randomUUID();const expectedResultVersion=snapshot.official?.version ?? 1;const resultVersion=expectedResultVersion+1;
  const completion=await prepareReviewCompletion(db,cmd,snapshot,resultVersionId,resultVersion,now);
  if(draft.judgment.performance==="지연 재현" && state.review && !completion?.delayed) throw domainFailure("reference_conflict","review.delayed-confirmation-evidence",null);
  const next=tutorState.parse({...state,version:state.version+1,phase:"finished",resumePhase:null,pending:null});recordId.parse(answerId);
  return executeAtomic(db,cmd,"session.confirm",input,input.id,next.version,(requestId)=>[
    ...snapshotGuards(db,cmd,snapshot,requestId),
    ...(completion ? reviewCompletionGuards(db,cmd,completion,state.id,requestId) : []),
    requireInBatch(db,cmd.owner.userId,requestId,0,"NOT EXISTS(SELECT 1 FROM session_confirmations WHERE owner_id=? AND session_id=?)",[cmd.owner.userId,input.id]),
    ...guardedUpdate(db,"sessions",cmd.owner.userId,state.id,input.expectedSessionVersion,requestId,1,"status='finished'",[],"1",[]),
    ...guardedUpdate(db,"tutor_sessions",cmd.owner.userId,state.id,input.expectedVersion,requestId,2,"state=?",[JSON.stringify(next)],"1",[]),
    ...(snapshot.official ? [] : [requireInBatch(db,cmd.owner.userId,requestId,3,"NOT EXISTS(SELECT 1 FROM learning_results WHERE owner_id=? AND unit_id=?)",[cmd.owner.userId,state.start.bundle.unit.unitId]),db.prepare("INSERT INTO learning_results VALUES (?,?,1,?,?,NULL)").bind(cmd.owner.userId,resultId,requestId,state.start.bundle.unit.unitId)]),
    ...guardedUpdate(db,"learning_results",cmd.owner.userId,resultId,expectedResultVersion,requestId,4,"unit_id=unit_id",[],"current_version_id IS ?",[snapshot.official?.currentId ?? null]),
    ...(completion ? correctionRecheckStatements(db,cmd,completion,requestId,now) : []),
    db.prepare("INSERT INTO confirmed_results VALUES (?,?,?,?,?,?,?,?,NULL)").bind(cmd.owner.userId,resultVersionId,resultId,resultVersion,answerId,draft.judgment.progress,draft.judgment.performance,now),
    db.prepare("UPDATE learning_results SET current_version_id=? WHERE owner_id=? AND id=? AND last_request_id=?").bind(resultVersionId,cmd.owner.userId,resultId,requestId),
    db.prepare("INSERT INTO result_next_actions VALUES (?,?,?)").bind(cmd.owner.userId,resultVersionId,draft.judgment.nextAction),
    db.prepare("INSERT INTO session_confirmations VALUES (?,?,?,?,?,?,?)").bind(cmd.owner.userId,state.id,resultVersionId,state.version,input.fingerprint,JSON.stringify(draft.judgment),now),
    ...(completion ? reviewCompletionStatements(db,cmd,completion,requestId,now) : reviewTargets(db,cmd,snapshot,resultVersionId,answerId,resultVersion,requestId,now)),
    db.prepare("INSERT INTO tutor_events VALUES (?,?,?,?,?,?)").bind(cmd.owner.userId,requestId,state.id,next.version,JSON.stringify({input,state:next}),now),
  ]);
}
