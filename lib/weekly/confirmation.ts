import { z } from "zod";
import { domainFailure,recordId,version } from "../domain/contracts.ts";
import type { WeeklyWorkspace } from "./workspace.ts";
import { allocateWeeklyProposal } from "./planning.ts";
import { requireWeeklyClaims } from "./claims.ts";
import type { WeeklyContent } from "../../db/repositories/weekly.ts";

export const weeklyConfirm=z.object({id:recordId,expectedVersion:version,businessKey:z.string().min(1).max(200),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type WeeklyConfirm=z.infer<typeof weeklyConfirm>;
export function weeklyBusinessKey(state:WeeklyWorkspace):string{return `weekly:${state.courseId}:${state.context.aggregate.period.start}`;}
/** 대화·실제 답안·내 메모를 제외하고 확정한 보고서 필드만 내보냅니다. */
export function weeklyExportContent(state:WeeklyWorkspace):WeeklyContent {
  if(!state.proposal) throw domainFailure("validation","weekly.proposal-required",{id:state.id});
  requireWeeklyClaims(state.claims,state.context.aggregate,state.context.sources.map(source=>source.id));
  if(state.claims.length!==state.proposal.claimIds.length || state.claims.some(claim=>!state.proposal?.claimIds.includes(claim.id))) throw domainFailure("reference_conflict","weekly.confirmed-claim-selection",{id:state.id});
  const allocation=allocateWeeklyProposal(state.proposal,state.context);
  const lines=(kinds:readonly string[],empty:string):string=>{const found=state.claims.filter(claim=>kinds.includes(claim.kind)).map(claim=>claim.content);return found.length>0 ? found.join("\n") : empty;};
  return {achievements:lines(["independent-new-condition","independent-explanation","delayed-recall"],"이번 주 선택한 확정 성과 근거가 없어요."),difficulties:lines(["incorrect-answer","helped-performance"],"선택한 확정 기록에 어려움의 근거가 없어요. 어려움이 없었다는 뜻은 아니에요."),improvements:lines(["editor-improvement","correction-recheck"],"확정 답안으로 확인한 개선 근거가 없어요."),nextActions:[`다음 주 제안 · 가용 ${allocation.availableMinutes}분 / 예상 ${allocation.estimatedMinutes}분 / 배정 ${allocation.allocatedMinutes}분`,...allocation.items.map(entry=>`${entry.status==="assigned" ? "배정" : "미배정"} · ${entry.item.activity} · 예상 ${entry.item.estimatedMinutes}분`),"기존 복습·지연 재현 일정은 유지해요."].join("\n")};
}
