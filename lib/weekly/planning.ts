import { roommateExplanation,validateRoommate } from "./roommate.ts";
import { z } from "zod";
import { recordId,domainFailure } from "../domain/contracts.ts";
import { confirmedUnit,sourceExcerpt } from "../librarian/contracts.ts";
import { weeklyAggregate } from "./evidence.ts";
import { supportedWeeklyClaims } from "./claims.ts";
import { weeklyAdjustmentRules,prioritizeWeeklyItems } from "./adjustments.ts";
import type { WeeklyClaim } from "./claims.ts";

export const weeklyPlanningContext=z.object({aggregate:weeklyAggregate,units:z.array(confirmedUnit).min(1).max(100),sources:z.array(sourceExcerpt).max(200),availableMinutes:z.number().int().min(0).max(10080).nullable()}).strict();
export type WeeklyPlanningContext=Readonly<z.infer<typeof weeklyPlanningContext>>;
export const weeklyAdjustment=z.enum(["increase-difficulty","add-practice","return-to-prerequisite","gather-evidence"]);
export type WeeklyAdjustment=z.infer<typeof weeklyAdjustment>;
export const weeklyPlanItem=z.object({unitId:recordId,targetUnitId:recordId,action:weeklyAdjustment,estimatedMinutes:z.number().int().min(5).max(240),activity:z.string().min(1).max(2000).regex(/\S/),claimIds:z.array(z.string().min(1).max(100)).max(20)}).strict();
export type WeeklyPlanItem=Readonly<z.infer<typeof weeklyPlanItem>>;
export const weeklyProposal=z.object({kind:z.literal("weekly-review"),claimIds:z.array(z.string().min(1).max(100)).max(40),items:z.array(weeklyPlanItem).max(12),roommate:roommateExplanation,uncertainty:z.array(z.string().min(1).max(1000).regex(/\S/)).min(1).max(12),requiresConfirmation:z.literal(true)}).strict();
export type WeeklyProposal=Readonly<z.infer<typeof weeklyProposal>>;
export type AllocatedWeeklyItem=Readonly<{item:WeeklyPlanItem;allocatedMinutes:number;status:"assigned"|"unassigned";reason:string}>;
export type WeeklyAllocation=Readonly<{availableMinutes:number;estimatedMinutes:number;allocatedMinutes:number;items:readonly AllocatedWeeklyItem[]}>;

function itemEvidence(item:WeeklyPlanItem,claims:readonly WeeklyClaim[]):readonly WeeklyClaim[] {
  const found=item.claimIds.map(id=>claims.find(claim=>claim.id===id));
  if(new Set(item.claimIds).size!==item.claimIds.length || found.some(claim=>!claim)) throw domainFailure("reference_conflict","weekly.plan-claim-reference",{unitId:item.unitId});
  return found.filter((claim):claim is WeeklyClaim=>claim!==undefined);
}
/** 수행 근거와 대상 단원을 대조하며 제안으로 기존 계획·복습을 변경하지 않습니다. */
export function validateWeeklyPlan(proposal:WeeklyProposal,context:WeeklyPlanningContext):void {
  weeklyProposal.parse(proposal);weeklyPlanningContext.parse(context);
  if(context.availableMinutes===null) throw domainFailure("validation","weekly.available-time-missing",null);
  if(context.units.some(unit=>unit.courseId!==context.aggregate.courseId)) throw domainFailure("reference_conflict","weekly.plan-course",null);
  const claims=supportedWeeklyClaims(context.aggregate,context.sources.map(source=>source.id));
  if(new Set(proposal.claimIds).size!==proposal.claimIds.length || proposal.claimIds.some(id=>!claims.some(claim=>claim.id===id))) throw domainFailure("reference_conflict","weekly.summary-claim-selection",null);
  validateRoommate(proposal.roommate,context.sources,context.units.map(unit=>unit.unitId));
  const rules=weeklyAdjustmentRules(context);
  const keys=proposal.items.map(item=>`${item.unitId}:${item.action}:${item.targetUnitId}`);if(new Set(keys).size!==keys.length) throw domainFailure("validation","weekly.plan-duplicate-item",null);
  for(const item of proposal.items) {
    const unit=context.units.find(unit=>unit.unitId===item.unitId);const target=context.units.find(unit=>unit.unitId===item.targetUnitId);
    if(!unit || !target) throw domainFailure("reference_conflict","weekly.plan-unit",{unitId:item.unitId,targetUnitId:item.targetUnitId});
    const evidence=itemEvidence(item,claims);const answers=evidence.map(claim=>context.aggregate.answers.find(answer=>answer.id===claim.answerId));
    if(answers.some(answer=>!answer || answer.unitId!==unit.unitId)) throw domainFailure("reference_conflict","weekly.plan-answer-unit",{unitId:item.unitId});
    if(item.action!=="return-to-prerequisite" && target.unitId!==unit.unitId) throw domainFailure("reference_conflict","weekly.plan-target-unit",{unitId:item.unitId});
    if(item.action==="increase-difficulty" && !evidence.some(claim=>claim.kind==="independent-new-condition" || claim.kind==="correction-recheck")) throw domainFailure("reference_conflict","weekly.plan-independent-required",null);
    if(item.action==="add-practice" && !evidence.some(claim=>["helped-performance","incorrect-answer","editor-improvement"].includes(claim.kind))) throw domainFailure("reference_conflict","weekly.plan-practice-evidence",null);
    if(item.action==="return-to-prerequisite" && (!unit.prerequisiteUnitIds.includes(target.unitId) || new Set(evidence.filter(claim=>claim.kind==="incorrect-answer").map(claim=>claim.answerId)).size<2)) throw domainFailure("reference_conflict","weekly.plan-prerequisite-evidence",null);
    const rule=rules.find(rule=>rule.unitId===item.unitId && rule.targetUnitId===item.targetUnitId && rule.action===item.action);
    if(!rule || item.claimIds.some(id=>!rule.claimIds.includes(id))) throw domainFailure("reference_conflict","weekly.adjustment-unsupported",{unitId:item.unitId,action:item.action});
    if(item.action!=="gather-evidence" && item.claimIds.length===0) throw domainFailure("reference_conflict","weekly.adjustment-evidence-missing",{unitId:item.unitId});
  }
}
/** 전체 활동의 예상 시간을 배정하며 남은 시간에 억지로 잘라 실행 가능하다고 표시하지 않습니다. */
export function allocateWeeklyPlan(items:readonly WeeklyPlanItem[],availableMinutes:number):WeeklyAllocation {
  z.number().int().min(0).max(10080).parse(availableMinutes);
  const initial:WeeklyAllocation={availableMinutes,estimatedMinutes:0,allocatedMinutes:0,items:[]};
  return items.reduce((state,item):WeeklyAllocation=>{weeklyPlanItem.parse(item);const assigned=state.allocatedMinutes+item.estimatedMinutes<=availableMinutes;const allocatedMinutes=assigned ? item.estimatedMinutes : 0;return {availableMinutes,estimatedMinutes:state.estimatedMinutes+item.estimatedMinutes,allocatedMinutes:state.allocatedMinutes+allocatedMinutes,items:[...state.items,{item,allocatedMinutes,status:assigned ? "assigned" : "unassigned",reason:assigned ? "입력한 가용 시간 안의 예상 배정이에요." : "가용 시간이 부족해 미배정으로 남겼어요."}]};},initial);
}

export function allocateWeeklyProposal(proposal:WeeklyProposal,context:WeeklyPlanningContext):WeeklyAllocation {
  validateWeeklyPlan(proposal,context);if(context.availableMinutes===null) throw domainFailure("validation","weekly.available-time-missing",null);
  return allocateWeeklyPlan(prioritizeWeeklyItems(proposal.items,context),context.availableMinutes);
}
