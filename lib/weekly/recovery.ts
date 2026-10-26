import { z } from "zod";
import type { AiRequestState } from "../../db/repositories/ai-status.ts";
import type { WeeklyWorkspace } from "./workspace.ts";

export const weeklyGenerationRecovery=z.object({allowed:z.boolean(),reason:z.string()}).strict();
export type WeeklyGenerationRecovery=Readonly<z.infer<typeof weeklyGenerationRecovery>>;
export type WeeklyAttemptStatus=Pick<AiRequestState,"stage"|"reservationState"|"outstandingReservedUnits"|"responseId">;

/** 전송 예약이 없거나 비용까지 확정된 실패만 다시 열며 결과 불명 예약은 그대로 보존합니다. */
export function weeklyRecoveryDecision(state:WeeklyWorkspace,current:boolean,statuses:readonly WeeklyAttemptStatus[]):WeeklyGenerationRecovery {
  if(state.phase!=="generating" || !state.pendingKey) return {allowed:false,reason:"진행 중인 주간 AI 요청이 없어요."};
  if(statuses.length===0) return {allowed:true,reason:"아직 AI 전송 예약이 없어요. 새 호출 없이 초안을 다시 열 수 있어요."};
  const settled=statuses.every(status=>(status.reservationState==="settled" || status.reservationState==="released") && status.outstandingReservedUnits===0);
  if(!settled) return {allowed:false,reason:"진행 중이거나 비용·전송 결과가 미확정인 시도가 있어요. 기존 요청 확인과 대사를 마친 뒤 다시 열 수 있어요."};
  if(statuses.every(status=>status.stage==="invalid")) return {allowed:true,reason:"AI 결과 검증이 실패했지만 사용량은 확정됐어요. 실패 이력과 비용을 보존하고 초안을 다시 열 수 있어요."};
  if(!current && statuses.every(status=>status.responseId!==null && status.stage!==null && ["settled","validated","invalid"].includes(status.stage))) return {allowed:true,reason:"응답과 비용은 확정됐지만 학습 근거가 바뀌었어요. 이전 결과를 적용하지 않고 현재 근거로 초안을 다시 열 수 있어요."};
  return {allowed:false,reason:"저장된 응답을 먼저 기존 요청 확인으로 복구해 주세요. 새 AI 호출은 하지 않아요."};
}
