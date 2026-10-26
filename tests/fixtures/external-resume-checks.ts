import { fixtureExternalExecution } from "./external-execution-checks.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { readExternalWorkflowView,resumeExternalWorkflow } from "../../lib/external/resume.ts";
import type { ExternalTransport,ExternalExecutionRuntime } from "../../lib/external/execute.ts";
import { siteIdentity } from "../../lib/domain/contracts.ts";

function ensure(value:boolean,label:string):void {if(!value) throw new Error(label);}
async function rejected(run:()=>Promise<unknown>):Promise<void> {try{await run();}catch(error:unknown){if(error instanceof Error && "code" in error && error.code==="reference_conflict") return;throw error;}throw new Error("소유자·계정 불일치 재개가 허용됐습니다.");}
export async function checkExternalResume(db:D1Database):Promise<readonly string[]> {
  const now:number=Date.parse("2026-10-25T02:00:00Z");const fixture=await fixtureExternalExecution(db,"external-resume-owner",now,"fixed-doc");
  const row=await readExternalOperation(db,fixture.owner,fixture.operationId);let writes:number=0;let reads:number=0;
  const runtime:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),warn:()=>{},jitter:()=>0,requestBudgetMs:30_000};
  const transport:ExternalTransport={write:async context=>{writes+=1;await fixture.request(context,"docs.documents.batchUpdate",now);return {externalId:"fixed-doc",providerRequestId:context.attemptId,status:200};},read:async context=>{reads+=1;await fixture.request(context,"docs.documents.get",now);return {receipt:{id:context.attemptId,status:200},observation:{status:"available",externalId:"fixed-doc",content:{kind:"document",title:"fixed-report",text:"confirmed text",tabId:"t.0",documentTabCount:1}}};}};
  await rejected(()=>readExternalWorkflowView(db,siteIdentity.parse({realm:"sites",userId:"other-owner"}),row.workflowId));
  await rejected(()=>resumeExternalWorkflow(db,siteIdentity.parse({realm:"sites",userId:"other-owner"}),row.workflowId,transport,runtime));
  await db.prepare("UPDATE google_runtime SET state='reconsent' WHERE owner_id=?").bind(fixture.owner.userId).run();
  await rejected(()=>resumeExternalWorkflow(db,fixture.owner,row.workflowId,transport,runtime));
  ensure(writes===0 && reads===0,"재연결 필요 상태에서 API 실행");
  await db.prepare("UPDATE google_runtime SET state='active' WHERE owner_id=?").bind(fixture.owner.userId).run();
  await db.prepare("UPDATE google_connections SET google_subject='different-account' WHERE owner_id=?").bind(fixture.owner.userId).run();
  await rejected(()=>resumeExternalWorkflow(db,fixture.owner,row.workflowId,transport,runtime));
  await db.prepare("UPDATE google_connections SET google_subject=? WHERE owner_id=?").bind(fixture.connection.googleSubject,fixture.owner.userId).run();
  ensure((await resumeExternalWorkflow(db,fixture.owner,row.workflowId,{...transport},{...runtime})).view.state==="running","새 요청에서 쓰기 재개 실패");
  const resumed=await resumeExternalWorkflow(db,fixture.owner,row.workflowId,{...transport},{...runtime});
  ensure(resumed.view.state==="confirmed" && writes===1 && reads===1,"새 인스턴스의 저장 상태 기반 확인 실패");
  ensure((await resumeExternalWorkflow(db,fixture.owner,row.workflowId,{...transport},{...runtime})).disposition==="retained" && writes===1 && reads===1,"완료 작업 재개 시 중복 실행");
  const serialized:string=JSON.stringify(resumed.view);ensure(!serialized.includes("confirmed text") && !serialized.includes(fixture.connection.googleSubject),"진행 응답에 원문·계정 식별값 포함");
  return ["workflow-resume-other-owner-denied", "reconsent-and-different-google-account-stop-before-calls", "fresh-request-resumes-from-d1-and-skips-confirmed", "progress-view-excludes-learning-content-and-google-identity"];
}
