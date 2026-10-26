import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts.ts";
import { weeklyRecoveryDecision } from "../../lib/weekly/recovery.ts";
import { weeklyWorkspace } from "../../lib/weekly/workspace.ts";
import type { WeeklyWorkspace } from "../../lib/weekly/workspace.ts";
import { readAiRequestStatus } from "./ai-status.ts";
import type { AiRequestState } from "./ai-status.ts";
import { executeAtomic,readAtomicReceipt,requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { loadWeeklyBasis,readWeeklyWorkspace,weeklyWorkspaceStatements } from "./weekly-workspace.ts";

/** 초기화와 구 실행의 비용 예약을 같은 D1 직렬화 경계에서 경쟁시킵니다. */
export function weeklyGenerationGuard(db:D1Database,owner:SiteIdentity,state:WeeklyWorkspace,requestId:string):D1PreparedStatement {
  if(state.phase!=="generating" || !state.pendingKey) throw domainFailure("version_conflict","weekly.generation-state",{id:state.id});
  return requireInBatch(db,owner.userId,requestId,9900,"EXISTS(SELECT 1 FROM weekly_summaries s JOIN weekly_drafts d ON d.owner_id=s.owner_id AND d.summary_id=s.id WHERE s.owner_id=? AND s.id=? AND s.version=? AND d.version=? AND json_extract(d.content,'$.phase')='generating' AND json_extract(d.content,'$.pendingKey')=?)",[owner.userId,state.id,state.version,state.version,state.pendingKey]);
}

function attemptGuards(db:D1Database,owner:SiteIdentity,key:string,statuses:readonly AiRequestState[],requestId:string):readonly D1PreparedStatement[] {
  return [requireInBatch(db,owner.userId,requestId,1000,"(SELECT count(*) FROM ai_cost_intents WHERE owner_id=? AND scope='openai.response' AND request_key IN (?,?,?))=?",[owner.userId,`${key}:1`,`${key}:2`,`${key}:3`,statuses.length]),...statuses.map((status,index)=>requireInBatch(db,owner.userId,requestId,1001+index,"EXISTS(SELECT 1 FROM ai_cost_intents i JOIN cost_reservations r ON r.owner_id=i.owner_id AND r.id=i.id LEFT JOIN ai_calls c ON c.owner_id=i.owner_id AND c.id=i.id WHERE i.owner_id=? AND i.id=? AND r.state=? AND c.stage IS ? AND c.response_id IS ? AND r.actual_units IS ?)",[owner.userId,status.callId,status.reservationState,status.stage,status.responseId,status.actualUnits]))];
}

/** 비용·실패 이력을 수정하지 않고 확정된 실패 또는 전송 전 의도를 명시적으로 닫습니다. */
export async function resetWeeklyGeneration(db:D1Database,bucket:R2Bucket,cmd:Command,id:string):Promise<Receipt> {
  const payload={id};const replay=await readAtomicReceipt(db,cmd,"weekly.workspace-reset-generation",payload,id);if(replay) return replay;
  const state=await readWeeklyWorkspace(db,cmd.owner,id);
  if(state.version!==cmd.expectedVersion || state.phase!=="generating" || !state.pendingKey) throw domainFailure("version_conflict","weekly.reset-generation-version",{id});
  const fresh=await loadWeeklyBasis(db,bucket,cmd.owner,{id:state.id,courseId:state.courseId,date:state.date,availableMinutes:state.context.availableMinutes});
  const statuses=await readAiRequestStatus(db,cmd.owner,state.pendingKey);
  if(!weeklyRecoveryDecision(state,state.fingerprint===fresh.state.fingerprint,statuses).allowed) throw domainFailure("result_unknown","weekly.reset-generation-unresolved",{id});
  const next=weeklyWorkspace.parse({...fresh.state,version:state.version+1,notes:state.notes});
  return executeAtomic(db,cmd,"weekly.workspace-reset-generation",payload,id,next.version,requestId=>[
    weeklyGenerationGuard(db,cmd.owner,state,requestId),...attemptGuards(db,cmd.owner,state.pendingKey!,statuses,requestId),
    ...weeklyWorkspaceStatements(db,cmd,{...fresh.state,version:state.version},next,fresh.current,requestId),
  ]);
}
