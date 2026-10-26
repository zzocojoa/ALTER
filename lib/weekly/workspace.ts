import { z } from "zod";
import { domainFailure,recordId,studyDate,version } from "../domain/contracts.ts";
import { weeklyPlanningContext,weeklyProposal,validateWeeklyPlan } from "./planning.ts";
import { weeklyClaim,requireWeeklyClaims,supportedWeeklyClaims } from "./claims.ts";

export const weeklyWorkspace=z.object({id:recordId,version,courseId:recordId,date:studyDate,context:weeklyPlanningContext,fingerprint:z.string().regex(/^[a-f0-9]{64}$/),phase:z.enum(["draft","generating","proposed","confirmed"]),proposal:weeklyProposal.nullable(),claims:z.array(weeklyClaim).max(40),notes:z.string().max(4000),pendingKey:z.string().min(1).max(200).nullable(),confirmedVersionId:recordId.nullable()}).strict();
export type WeeklyWorkspace=Readonly<z.infer<typeof weeklyWorkspace>>;
export const weeklyStart=z.object({id:recordId,courseId:recordId,date:studyDate,availableMinutes:z.number().int().min(0).max(10080).nullable()}).strict();
export type WeeklyStart=Readonly<z.infer<typeof weeklyStart>>;
export const weeklyEdit=z.object({availableMinutes:z.number().int().min(0).max(10080),proposal:weeklyProposal,notes:z.string().max(4000)}).strict();
export type WeeklyEdit=Readonly<z.infer<typeof weeklyEdit>>;
export function validatedWeeklyDraft(state:WeeklyWorkspace,input:WeeklyEdit):WeeklyWorkspace {
  weeklyEdit.parse(input);const context={...state.context,availableMinutes:input.availableMinutes};validateWeeklyPlan(input.proposal,context);
  const catalog=supportedWeeklyClaims(context.aggregate,context.sources.map(source=>source.id));const claims=input.proposal.claimIds.map(id=>{const claim=catalog.find(claim=>claim.id===id);if(!claim) throw domainFailure("reference_conflict","weekly.draft-claim",{claimId:id});return claim;});
  requireWeeklyClaims(claims,context.aggregate,context.sources.map(source=>source.id));
  return weeklyWorkspace.parse({...state,version:state.version+1,context,proposal:input.proposal,claims,notes:input.notes,phase:"proposed",pendingKey:null,confirmedVersionId:null});
}
