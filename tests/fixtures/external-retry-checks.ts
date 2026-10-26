import { fixtureExternalExecution } from "./external-execution-checks.ts";
import { runExternalOperation } from "../../lib/external/execute.ts";
import type { ExternalExecutionRuntime,ExternalTransport } from "../../lib/external/execute.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { prepareGoogleRestRequest } from "../../lib/google/rest-request.ts";
import { sendGoogleRestAttempt } from "../../lib/google/rest-transport.ts";

function ensure(value:boolean,label:string):void {if(!value) throw new Error(label);}
async function rejected(run:()=>Promise<unknown>,code:string):Promise<void> {try{await run();}catch(error:unknown){if(error instanceof Error && "code" in error && error.code===code) return;throw error;}throw new Error("예상한 재시도 오류 누락");}
export async function checkExternalRetry(db:D1Database):Promise<readonly string[]> {
  let now:number=Date.parse("2026-10-25T02:00:00Z");const fixed=await fixtureExternalExecution(db,"external-retry-owner",now,"fixed-doc");
  let writes:number=0;let reads:number=0;
  const runtime:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),warn:()=>{},jitter:()=>0,requestBudgetMs:30_000};
  const request=await prepareGoogleRestRequest({method:"docs.documents.get",documentId:"fixed-doc"},"docs-target");
  const transport:ExternalTransport={write:async context=>{writes+=1;await fixed.request(context,"docs.documents.batchUpdate",now);return {externalId:"fixed-doc",providerRequestId:context.attemptId,status:200};},read:async()=>{
    reads+=1;
    await sendGoogleRestAttempt({fetch:async()=>Response.json({error:{errors:[{reason:"rateLimitExceeded"}]}},{status:429,headers:{"retry-after":"5"}}),now:()=>now,wait:async()=>{throw new Error("요청 내 대기 금지");},warn:()=>{}},request,"fixture-token");
    throw new Error("429 오류가 반환되지 않았습니다.");
  }};
  await runExternalOperation(db,fixed.owner,fixed.operationId,transport,runtime);
  await rejected(()=>runExternalOperation(db,fixed.owner,fixed.operationId,transport,runtime),"google_rest_failed");
  ensure((await runExternalOperation(db,fixed.owner,fixed.operationId,transport,runtime)).disposition==="deferred" && reads===1,"Retry-After 이전 추가 호출");
  let row=await readExternalOperation(db,fixed.owner,fixed.operationId);ensure(row.nextAttemptAt===now+5000,"다음 재조회 시각 영속 실패");
  while(row.attemptCount<8) {now=row.nextAttemptAt;await rejected(()=>runExternalOperation(db,fixed.owner,fixed.operationId,{...transport},{...runtime}),"google_rest_failed");row=await readExternalOperation(db,fixed.owner,fixed.operationId);}
  now+=1000;
  await rejected(()=>runExternalOperation(db,fixed.owner,fixed.operationId,transport,runtime),"external_retry_exhausted");
  ensure(writes===1 && reads===7 && row.state==="unknown" && JSON.parse(row.lastError??"{}").status===429,"한도 도달 뒤 중복 쓰기 또는 마지막 오류 유실");
  const expired=await fixtureExternalExecution(db,"external-deadline-owner",now,"fixed-doc");now+=86_400_001;
  await rejected(()=>runExternalOperation(db,expired.owner,expired.operationId,transport,runtime),"external_retry_exhausted");
  ensure(writes===1 && reads===7,"전체 기한 후 추가 호출");
  return ["retry-after-persisted-and-no-early-read", "retry-exhaustion-keeps-last-429-without-repeat-write", "workflow-deadline-stops-new-calls"];
}
