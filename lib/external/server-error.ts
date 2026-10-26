import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { privateJson } from "../owner-access";
import { isDomainFailure } from "../../db/repositories/atomic.ts";
import { readExternalFailureHistory } from "../../db/repositories/external-errors.ts";
import type { ExternalFailureHistory } from "../../db/repositories/external-errors.ts";
import { classifyExternalFailure,externalFailure } from "./failure.ts";
import type { ExternalFailure } from "./failure.ts";
import { externalDiagnostic,externalFailureHttpStatus } from "./diagnostic.ts";

const executionError=z.object({name:z.literal("ExternalExecutionFailure"),code:z.string(),diagnostic:externalDiagnostic,storageFailure:externalFailure.nullable()});
const exhaustedError=z.object({code:z.literal("external_retry_exhausted"),operationId:recordId,reason:z.enum(["attempt-limit","deadline"])});
async function history(db:D1Database,owner:SiteIdentity,operationId:string):Promise<Readonly<{history:ExternalFailureHistory|null;historyFailure:ExternalFailure|null}>> {
  try {return {history:await readExternalFailureHistory(db,owner,operationId),historyFailure:null};}
  catch(error:unknown) {return {history:null,historyFailure:classifyExternalFailure(error,"verify")};}
}
/** 서버 오류 객체의 메시지·cause·응답 본문을 그대로 직렬화하지 않고 허용된 진단 필드만 반환합니다. */
export async function externalErrorResponse(db:D1Database,owner:SiteIdentity,error:unknown):Promise<Response> {
  if(error instanceof z.ZodError) return privateJson({error:"external_input_invalid",message:"외부 작업 요청과 저장된 입력 형식을 확인해 주세요."},400);
  const execution=executionError.safeParse(error);
  if(execution.success) {
    const value=execution.data;
    return privateJson({error:value.code,diagnostic:value.diagnostic,storageFailure:value.storageFailure,...await history(db,owner,value.diagnostic.operationId),outcome:value.diagnostic.state==="conflict"?"conflict":"unconfirmed",message:"외부 작업을 완료하지 못했어요. 오류 사유와 재개 시각을 확인해 주세요."},value.storageFailure===null?externalFailureHttpStatus(value.diagnostic.failure):503);
  }
  const exhausted=exhaustedError.safeParse(error);
  if(exhausted.success) return privateJson({error:exhausted.data.code,reason:exhausted.data.reason,...await history(db,owner,exhausted.data.operationId),outcome:"unconfirmed",message:"조회 시도 횟수 또는 기한을 초과했어요. 외부 반영 결과를 확인해 주세요."},409);
  if(isDomainFailure(error)) return privateJson({error:error.code,message:"작업 소유자·현재 연결·저장 상태를 확인해 주세요."},error.operation==="external.resume.owner"?404:["storage_failure","result_unknown"].includes(error.code)?503:409);
  const failure:ExternalFailure=classifyExternalFailure(error,"verify");
  return privateJson({error:failure.code,failure,outcome:"unconfirmed",message:"외부 작업을 진행하지 못했어요. 연결 설정과 오류 사유를 확인해 주세요."},externalFailureHttpStatus(failure));
}
