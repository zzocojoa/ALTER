import { domainFailure } from "../domain/contracts.ts";
import { supportedWeeklyClaims } from "./claims.ts";
import type { WeeklyClaim } from "./claims.ts";
import type { ConfirmedUnit } from "../librarian/contracts.ts";
import type { WeeklyPlanningContext,WeeklyAdjustment,WeeklyPlanItem } from "./planning.ts";

export type WeeklyAdjustmentRule=Readonly<{unitId:ConfirmedUnit["unitId"];targetUnitId:ConfirmedUnit["unitId"];action:WeeklyAdjustment;claimIds:readonly string[];priority:number;reason:string;nextAction:string}>;
function unitClaims(context:WeeklyPlanningContext,unitId:string):readonly WeeklyClaim[] {
  const answers=context.aggregate.answers.filter(answer=>answer.unitId===unitId);
  return supportedWeeklyClaims(context.aggregate,context.sources.map(source=>source.id)).filter(claim=>answers.some(answer=>answer.id===claim.answerId));
}
function repeatedErrorClaims(context:WeeklyPlanningContext,unitId:string,claims:readonly WeeklyClaim[]):readonly WeeklyClaim[] {
  const reviews=context.aggregate.reviews.filter(review=>review.unitId===unitId && review.concept.trim().length>0);
  const concepts=[...new Set(reviews.map(review=>review.concept.trim()))];
  return claims.filter(claim=>claim.kind==="incorrect-answer" && concepts.some(concept=>{
    const ids=reviews.filter(review=>review.concept.trim()===concept).map(review=>review.answerId);
    return ids.includes(claim.answerId) && new Set(claims.filter(other=>other.kind==="incorrect-answer" && ids.includes(other.answerId)).map(other=>other.answerId)).size>=2;
  }));
}
function adjustmentsForUnit(context:WeeklyPlanningContext,unit:ConfirmedUnit):readonly WeeklyAdjustmentRule[] {
  const claims=unitClaims(context,unit.unitId);const repeated=repeatedErrorClaims(context,unit.unitId,claims);
  const prerequisites=unit.prerequisiteUnitIds.filter(id=>context.units.some(candidate=>candidate.unitId===id));
  const practice=claims.filter(claim=>["helped-performance","incorrect-answer","editor-improvement"].includes(claim.kind));
  const independent=claims.filter(claim=>["independent-new-condition","correction-recheck"].includes(claim.kind)).filter(claim=>{
    const answer=context.aggregate.answers.find(answer=>answer.id===claim.answerId);if(!answer) throw domainFailure("reference_conflict","weekly.adjustment-answer",{answerId:claim.answerId});
    return !context.aggregate.answers.some(later=>later.unitId===unit.unitId && later.submittedAt>answer.submittedAt && (later.helped || later.correct===false || later.needsRecheck));
  });
  const prerequisiteRules:readonly WeeklyAdjustmentRule[]=repeated.length>=2 ? prerequisites.map(targetUnitId=>({unitId:unit.unitId,targetUnitId,action:"return-to-prerequisite",claimIds:repeated.map(claim=>claim.id),priority:0,reason:"같은 개념의 서로 다른 오답이 반복됐어요. 확정 계획의 선수 관계를 따라 보완 후보를 확인하며, 선수 개념 부족이 원인이라고 단정하지 않아요.",nextAction:"선수 개념을 새 예시로 설명하고 실제 답안에서 막히는 지점을 확인하세요."})) : [];
  const practiceRules:readonly WeeklyAdjustmentRule[]=practice.length>0 ? [{unitId:unit.unitId,targetUnitId:unit.unitId,action:"add-practice",claimIds:practice.map(claim=>claim.id),priority:1,reason:repeated.length>=2 && prerequisites.length===0 ? "반복 오답이 있지만 확인된 선수 관계가 없어 원인을 확정할 수 없어요. 같은 단원의 실습에서 막힌 부분을 확인해요." : "도움 사용·오답·수정 개선 근거가 있어 독립 수행을 확인할 실습을 추가해요.",nextAction:"해설을 가리고 다른 예시를 직접 풀어 도움 없이 수행하는지 확인하세요."}] : [];
  const independentRules:readonly WeeklyAdjustmentRule[]=independent.length>0 ? [{unitId:unit.unitId,targetUnitId:unit.unitId,action:"increase-difficulty",claimIds:independent.map(claim=>claim.id),priority:2,reason:"새 조건 또는 정정 뒤 새 과제를 도움 없이 수행한 답안이 있어 조건을 하나 더 바꾸는 제안을 해요. 다음 난도 통과 여부는 미확인이에요.",nextAction:"조건을 하나 바꾼 과제를 직접 풀고 자기 말로 이유를 설명하세요."}] : [];
  const candidates=[...prerequisiteRules,...practiceRules,...independentRules];
  return candidates.length>0 ? candidates : [{unitId:unit.unitId,targetUnitId:unit.unitId,action:"gather-evidence",claimIds:claims.map(claim=>claim.id),priority:3,reason:"현재 주간의 검증된 새 과제 수행 근거가 부족해 수준이나 향상을 판단할 수 없어요.",nextAction:"짧은 새 조건 과제를 도움 없이 제출하여 현재 수행을 확인하세요."}];
}
/** 저장 상태를 바꾸지 않고 확정된 선수 관계와 답안 근거로 조정 후보를 만듭니다. */
export function weeklyAdjustmentRules(context:WeeklyPlanningContext):readonly WeeklyAdjustmentRule[] {
  return context.units.flatMap(unit=>adjustmentsForUnit(context,unit)).toSorted((left,right)=>left.priority-right.priority || left.unitId.localeCompare(right.unitId) || left.targetUnitId.localeCompare(right.targetUnitId));
}
/** 모델의 임의 우선순위 대신 보완·실습·난도 상승·근거 수집 순서를 적용합니다. */
export function prioritizeWeeklyItems(items:readonly WeeklyPlanItem[],context:WeeklyPlanningContext):readonly WeeklyPlanItem[] {
  const rules=weeklyAdjustmentRules(context);
  const ordered=items.map(item=>{const rule=rules.find(rule=>rule.unitId===item.unitId && rule.targetUnitId===item.targetUnitId && rule.action===item.action);if(!rule) throw domainFailure("reference_conflict","weekly.adjustment-unsupported",{unitId:item.unitId,action:item.action});return {item,priority:rule.priority};});
  return ordered.toSorted((left,right)=>left.priority-right.priority || left.item.unitId.localeCompare(right.item.unitId) || left.item.targetUnitId.localeCompare(right.item.targetUnitId)).map(entry=>entry.item);
}
