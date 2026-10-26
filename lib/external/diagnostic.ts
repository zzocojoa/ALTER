import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import { externalFailure,classifyExternalFailure } from "./failure.ts";
import type { ExternalFailure } from "./failure.ts";
import type { ExternalOperationRow } from "../../db/repositories/external-operation.ts";

export const externalDiagnostic=z.object({event:z.enum(["external_step_failed","external_retry_exhausted"]),workflowId:recordId,operationId:recordId,attemptId:recordId.nullable(),leaseEpoch:z.number().int().nonnegative(),attemptCount:z.number().int().nonnegative(),state:z.enum(["pending","running","received","confirmed","failed","unknown","conflict"]),nextAttemptAt:z.number().int().nonnegative(),failure:externalFailure.nullable()}).strict();
export type ExternalDiagnostic=Readonly<z.infer<typeof externalDiagnostic>>;
export type ExternalExecutionFailure=Error & Readonly<{code:string;diagnostic:ExternalDiagnostic;storageFailure:ExternalFailure|null}>;
export function externalDiagnosticEntry(row:ExternalOperationRow,attemptId:string|null,failure:ExternalFailure|null,event:ExternalDiagnostic["event"]):ExternalDiagnostic {
  return externalDiagnostic.parse({event,workflowId:row.workflowId,operationId:row.id,attemptId,leaseEpoch:row.leaseEpoch,attemptCount:row.attemptCount,state:row.state,nextAttemptAt:row.nextAttemptAt,failure});
}
export function externalExecutionFailure(diagnostic:ExternalDiagnostic,storageError:unknown):ExternalExecutionFailure {
  const safe:ExternalDiagnostic=externalDiagnostic.parse(diagnostic);
  const storageFailure:ExternalFailure|null=storageError===null?null:classifyExternalFailure(storageError,safe.failure?.phase??"verify");
  return Object.assign(new Error(storageFailure===null?"외부 작업을 완료하지 못했어요. 저장된 오류 사유와 재개 시각을 확인해 주세요.":"외부 실행 오류의 상태 저장도 완료하지 못했어요. 외부 반영 결과를 다시 확인해야 합니다."),{name:"ExternalExecutionFailure",code:storageFailure===null?safe.failure?.code??"external_unclassified_failure":"external_execution_save_failed",diagnostic:safe,storageFailure});
}
export function externalFailureHttpStatus(failure:ExternalFailure|null):number {
  if(failure===null) return 503;
  if(failure.category==="temporary") return 429;
  if(["authentication","permission","configuration","storage","conflict"].includes(failure.category)) return 409;
  return 503;
}
