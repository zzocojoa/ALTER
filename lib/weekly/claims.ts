import { z } from "zod";
import { recordId,version,domainFailure } from "../domain/contracts.ts";
import type { WeeklyAggregate,WeeklyAnswerEvidence } from "./evidence.ts";

export const weeklyClaimKind=z.enum(["independent-new-condition","independent-explanation","helped-performance","incorrect-answer","editor-improvement","correction-recheck","delayed-recall"]);
export type WeeklyClaimKind=z.infer<typeof weeklyClaimKind>;
export const weeklyClaim=z.object({id:z.string().min(1).max(100),kind:weeklyClaimKind,content:z.string().min(1).max(2000),sessionId:recordId,sessionVersion:version,answerId:recordId,answerVersion:version,resultVersionId:recordId,resultOrdinal:version,editorReviewId:recordId.nullable(),correctionId:recordId.nullable()}).strict();
export type WeeklyClaim=Readonly<z.infer<typeof weeklyClaim>>;
export type ClaimIssue=Readonly<{claimId:string;code:"duplicate"|"unsupported"|"evidence-changed";message:string}>;
const labels:Readonly<Record<WeeklyClaimKind,string>>={"independent-new-condition":"새 조건 과제를 도움 없이 수행함","independent-explanation":"자료를 가리고 자기 말로 설명함","helped-performance":"도움을 사용한 답안의 수행을 확인함","incorrect-answer":"제출 답안에서 오류가 확인됨","editor-improvement":"수정 이유와 피드백 개선 항목이 확인됨","correction-recheck":"정정 뒤 새 조건 과제의 독립 수행을 확인함","delayed-recall":"예정된 다른 학습일의 답안으로 지연 재현을 확인함"};
function supportedKinds(answer:WeeklyAnswerEvidence):readonly WeeklyClaimKind[] {
  if(answer.needsRecheck) return [];
  const kinds:WeeklyClaimKind[]=[];
  if(answer.accepted && answer.mode==="new-condition") kinds.push("independent-new-condition");
  if(answer.accepted && answer.mode==="self-explanation" && !answer.delayedRecall) kinds.push("independent-explanation");
  if(answer.helped && answer.correct===true) kinds.push("helped-performance");
  if(answer.correct===false) kinds.push("incorrect-answer");
  if(answer.editorRevision && answer.editorRevision.resolvedItemIds.length>0) kinds.push("editor-improvement");
  if(answer.correctionRechecked) kinds.push("correction-recheck");
  if(answer.delayedRecall) kinds.push("delayed-recall");
  return kinds;
}
/** 성과 문장은 검증된 유형과 실제 답안에서 만들며 자유 서술을 확정 성과로 승격하지 않습니다. */
export function supportedWeeklyClaims(aggregate:WeeklyAggregate,verifiedSourceIds:readonly string[]):readonly WeeklyClaim[] {
  return aggregate.answers.filter(answer=>answer.sourceRefIds.length>0 && answer.sourceRefIds.every(id=>verifiedSourceIds.includes(id))).flatMap(answer=>supportedKinds(answer).map((kind):WeeklyClaim=>weeklyClaim.parse({id:`${kind}:${answer.id}`,kind,content:`${answer.unitTitle}: ${labels[kind]}`,sessionId:answer.sessionId,sessionVersion:answer.sessionVersion,answerId:answer.id,answerVersion:answer.answerVersion,resultVersionId:answer.resultVersionId,resultOrdinal:answer.resultOrdinal,editorReviewId:kind==="editor-improvement" ? answer.editorRevision?.reviewId ?? null : null,correctionId:kind==="correction-recheck" ? answer.correctionId : null})));
}
/** 화면 검사와 저장·확정이 동일한 근거 비교 결과를 사용합니다. */
export function weeklyClaimIssues(claims:readonly WeeklyClaim[],aggregate:WeeklyAggregate,verifiedSourceIds:readonly string[]):readonly ClaimIssue[] {
  const catalog=supportedWeeklyClaims(aggregate,verifiedSourceIds);
  return claims.flatMap((raw,index):ClaimIssue[]=>{
    const claim=weeklyClaim.parse(raw);const current=catalog.find(item=>item.id===claim.id);
    if(claims.findIndex(item=>item.id===claim.id)!==index) return [{claimId:claim.id,code:"duplicate",message:"같은 답안의 같은 성과 주장을 중복 선택했어요."}];
    if(!current) return [{claimId:claim.id,code:"unsupported",message:"이 주간의 확정 답안·현재 출처·수행 수준으로 뒷받침되지 않는 주장이에요."}];
    if(JSON.stringify(current)!==JSON.stringify(claim)) return [{claimId:claim.id,code:"evidence-changed",message:"주장의 내용이나 회차·답안·확정 버전이 현재 근거와 달라요."}];
    return [];
  });
}
export function requireWeeklyClaims(claims:readonly WeeklyClaim[],aggregate:WeeklyAggregate,verifiedSourceIds:readonly string[]):void {
  const issues=weeklyClaimIssues(claims,aggregate,verifiedSourceIds);if(issues.length>0) throw domainFailure("reference_conflict","weekly.claim-evidence",issues);
}
