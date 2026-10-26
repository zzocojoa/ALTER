import { fixtureExternalExecution } from "./external-execution-checks.ts";
import { runExternalOperation } from "../../lib/external/execute.ts";
import type { ExternalExecutionRuntime,ExternalTransport } from "../../lib/external/execute.ts";
import type { ExternalDiagnostic } from "../../lib/external/diagnostic.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { readExternalFailureHistory } from "../../db/repositories/external-errors.ts";
import { prepareGoogleRestRequest } from "../../lib/google/rest-request.ts";
import { sendGoogleRestAttempt } from "../../lib/google/rest-transport.ts";

function ensure(value:boolean,label:string):void {if(!value) throw new Error(label);}
async function rejected(run:()=>Promise<unknown>):Promise<void> {try{await run();}catch(error:unknown){if(error instanceof Error && "code" in error && error.code==="google_rest_failed") return;throw error;}throw new Error("명시적인 제공사 오류 누락");}
export async function checkExternalDiagnostics(db:D1Database):Promise<readonly string[]> {
  let now:number=Date.parse("2026-10-25T02:00:00Z");const fixture=await fixtureExternalExecution(db,"external-diagnostic-owner",now,"fixed-doc");const warnings:ExternalDiagnostic[]=[];
  const runtime:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),jitter:()=>0,requestBudgetMs:30_000,warn:entry=>{warnings.push(entry);}};
  const failed=async(status:number):Promise<never>=>{
    const request=await prepareGoogleRestRequest({method:"docs.documents.get",documentId:"fixed-doc"},"docs-target");
    await sendGoogleRestAttempt({fetch:async()=>Response.json({error:{message:"secret-token personal text",errors:[{reason:status===503?"backendError":"rateLimitExceeded"}]}},{status}),now:()=>now,wait:async()=>{},warn:()=>{}},request,"secret-token");throw new Error("오류 미발생");
  };
  const transport:ExternalTransport={write:async()=>failed(503),read:async()=>failed(429)};
  await rejected(()=>runExternalOperation(db,fixture.owner,fixture.operationId,transport,runtime));now=(await readExternalOperation(db,fixture.owner,fixture.operationId)).nextAttemptAt;
  await rejected(()=>runExternalOperation(db,fixture.owner,fixture.operationId,transport,runtime));
  const history=await readExternalFailureHistory(db,fixture.owner,fixture.operationId);
  ensure(history.write?.failure.status===503 && history.verify?.failure.status===429 && history.last?.failure.status===429,"쓰기 원인 또는 마지막 조회 원인 유실");
  ensure(warnings.length===2 && warnings[0].leaseEpoch===1 && warnings[1].leaseEpoch===2,"선점 버전 진단 누락");
  ensure(!/secret-token|personal text/.test(JSON.stringify({history,warnings})),"진단 이력 민감값 노출");
  return ["write-error-and-latest-read-error-preserved-separately","structured-warnings-exclude-provider-messages-and-tokens"];
}
