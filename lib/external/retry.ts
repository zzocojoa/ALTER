import { z } from "zod";
import { timestamp } from "../domain/contracts.ts";

export const externalMaximumAttempts:number=8;
export type ExternalRetryPlan=Readonly<{status:"scheduled";nextAttemptAt:number}>|Readonly<{status:"exhausted";reason:"attempt-limit"|"deadline"}>;
const retryInput=z.object({attemptCount:z.number().int().min(1).max(1000),now:timestamp,deadlineAt:timestamp,retryAfterMs:z.number().int().nonnegative().safe().nullable(),jitter:z.number().min(0).max(1)}).strict();
export type ExternalRetryInput=Readonly<z.infer<typeof retryInput>>;
/** 대기는 영속 시각으로만 표현하며 재시도 예정은 쓰기 재전송 권한이 아닙니다. */
export function planExternalRetry(value:ExternalRetryInput):ExternalRetryPlan {
  const input:ExternalRetryInput=retryInput.parse(value);
  if(input.attemptCount>=externalMaximumAttempts) return {status:"exhausted",reason:"attempt-limit"};
  const backoff:number=Math.min(600_000,1000*2**(input.attemptCount-1)+Math.floor(input.jitter*1000));
  const wait:number=Math.max(backoff,input.retryAfterMs??0);
  if(input.deadlineAt<=input.now || wait>=input.deadlineAt-input.now) return {status:"exhausted",reason:"deadline"};
  return {status:"scheduled",nextAttemptAt:input.now+wait};
}
export type ExternalRetryExhausted=Error & Readonly<{code:"external_retry_exhausted";operationId:string;reason:"attempt-limit"|"deadline";lastFailure:string|null;outcome:"unconfirmed"}>;
export function externalRetryExhausted(operationId:string,reason:ExternalRetryExhausted["reason"],lastFailure:string|null):ExternalRetryExhausted {
  return Object.assign(new Error("외부 작업의 조회 시도 횟수 또는 기한을 초과했어요. 마지막 오류와 외부 반영 상태를 확인해 주세요."),{name:"ExternalRetryExhausted",code:"external_retry_exhausted" as const,operationId,reason,lastFailure,outcome:"unconfirmed" as const});
}
