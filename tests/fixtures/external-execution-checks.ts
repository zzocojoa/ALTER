import { fixtureGoogleConnection } from "./google-connected.ts";
import { createExternalWorkflow } from "../../db/repositories/external-workflow.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { runExternalOperation } from "../../lib/external/execute.ts";
import type { ExternalCallContext, ExternalExecutionRuntime, ExternalTransport } from "../../lib/external/execute.ts";
import type { ExternalWorkflowSeed } from "../../lib/external/creation.ts";
import { contentHash } from "../../lib/domain/contracts.ts";

function ensure(value:boolean,label:string):void {if(!value) throw new Error(label);}
async function rejected(run:()=>Promise<unknown>):Promise<void> {try{await run();}catch(error:unknown){if(error instanceof Error) return;throw error;}throw new Error("실패 주입이 적용되지 않았습니다.");}
type ExecutionFixture=Awaited<ReturnType<typeof fixtureGoogleConnection>> & Readonly<{operationId:string;request:(context:ExternalCallContext,method:string,time:number)=>Promise<void>}>;
export async function fixtureExternalExecution(db:D1Database,ownerId:string,now:number,externalId:string|null):Promise<ExecutionFixture> {
  const connected=await fixtureGoogleConnection(db,ownerId,now);
  const seed:ExternalWorkflowSeed={jobId:null,kind:"calendar",targetKey:"fixed-test",sourceVersion:"v1",predecessorId:null,operations:[{kind:"document-write",stepKind:"google-docs-weekly-report",businessKey:"fixed-write",requestSnapshot:'{}',expectedSnapshot:JSON.stringify({kind:"document",title:"fixed-report",text:"confirmed text",tab:{kind:"single-tab"}}),externalId}]};
  const job=await createExternalWorkflow(db,connected.owner,"execute",seed,now);
  const row=await db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND workflow_id=?").bind(ownerId,job.id).first<{id:string}>();if(!row) throw new Error("실행 시험 단계 없음");
  const request=async(context:ExternalCallContext,method:string,time:number):Promise<void>=>{
    await context.beforeCall();
    await db.prepare("INSERT INTO google_requests VALUES (?,?,?,?,?,?,1,?,?,'succeeded',?,?,?,?,0,200,NULL,NULL)").bind(ownerId,context.attemptId,"fixture-project",connected.connection.googleSubject,connected.connection.connectionId,connected.connection.generation,method,await contentHash({operation:context.operation.id,method}),time,time+60_000,time,time).run();
  };
  return {...connected,operationId:row.id,request};
}
export async function checkExternalExecution(db:D1Database):Promise<readonly string[]> {
  const now:number=Date.parse("2026-10-25T02:00:00Z");const runtime:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),requestBudgetMs:30_000,jitter:()=>0,warn:()=>{}};
  const ordinary=await fixtureExternalExecution(db,"external-execution-ordinary",now,"fixed-doc");let writes:number=0;let reads:number=0;
  const transport:ExternalTransport={write:async context=>{writes+=1;await ordinary.request(context,"docs.documents.batchUpdate",now);return {externalId:"fixed-doc",providerRequestId:context.attemptId,status:200};},read:async context=>{reads+=1;await ordinary.request(context,"docs.documents.get",now);return {receipt:{id:context.attemptId,status:200},observation:{status:"available",externalId:"fixed-doc",content:{kind:"document",title:"fixed-report",text:"confirmed text",tabId:"t.0",documentTabCount:1}}};}};
  const first=await runExternalOperation(db,ordinary.owner,ordinary.operationId,transport,runtime);
  ensure(first.operation.state==="received" && writes===1 && reads===0,"쓰기 응답만으로 완료 또는 한 요청에서 여러 단계 실행");
  ensure((await runExternalOperation(db,ordinary.owner,ordinary.operationId,transport,runtime)).operation.state==="confirmed","재조회 일치 후 완료 실패");
  await runExternalOperation(db,ordinary.owner,ordinary.operationId,transport,runtime);
  ensure(writes===1 && reads===1,"확인 완료 단계 재실행");
  const lost=await fixtureExternalExecution(db,"external-execution-lost",now,"fixed-doc");let lostWrites:number=0;
  const lostTransport:ExternalTransport={write:async context=>{lostWrites+=1;await lost.request(context,"docs.documents.batchUpdate",now);throw new TypeError("고정 시험: 외부 반영 후 응답 유실");},read:async context=>{await lost.request(context,"docs.documents.get",now);return {receipt:{id:context.attemptId,status:200},observation:{status:"available",externalId:"fixed-doc",content:{kind:"document",title:"fixed-report",text:"confirmed text",tabId:"t.0",documentTabCount:1}}};}};
  await rejected(()=>runExternalOperation(db,lost.owner,lost.operationId,lostTransport,runtime));
  ensure((await readExternalOperation(db,lost.owner,lost.operationId)).state==="unknown","응답 유실 상태 누락");
  ensure((await runExternalOperation(db,lost.owner,lost.operationId,lostTransport,runtime)).operation.state==="confirmed" && lostWrites===1,"응답 유실 뒤 쓰기 재전송");
  const stopped=await fixtureExternalExecution(db,"external-execution-save-failed",now,"fixed-doc");let stoppedWrites:number=0;
  const stoppedTransport:ExternalTransport={write:async context=>{stoppedWrites+=1;await stopped.request(context,"docs.documents.batchUpdate",now);return {externalId:"fixed-doc",providerRequestId:context.attemptId,status:200};},read:async context=>{await stopped.request(context,"docs.documents.get",now);return {receipt:{id:context.attemptId,status:200},observation:{status:"available",externalId:"fixed-doc",content:{kind:"document",title:"fixed-report",text:"confirmed text",tabId:"t.0",documentTabCount:1}}};}};
  await db.prepare("CREATE TRIGGER external_write_save_failure BEFORE UPDATE OF state ON external_operations WHEN NEW.owner_id='external-execution-save-failed' AND NEW.state='received' BEGIN SELECT RAISE(ABORT,'injected_write_save_failure'); END").run();
  await rejected(()=>runExternalOperation(db,stopped.owner,stopped.operationId,stoppedTransport,runtime));
  await db.prepare("DROP TRIGGER external_write_save_failure").run();
  await db.prepare("CREATE TRIGGER external_verify_save_failure BEFORE UPDATE OF state ON external_operations WHEN NEW.owner_id='external-execution-save-failed' AND NEW.state='confirmed' BEGIN SELECT RAISE(ABORT,'injected_verify_save_failure'); END").run();
  await rejected(()=>runExternalOperation(db,stopped.owner,stopped.operationId,stoppedTransport,runtime));
  await db.prepare("DROP TRIGGER external_verify_save_failure").run();
  ensure((await runExternalOperation(db,stopped.owner,stopped.operationId,stoppedTransport,runtime)).operation.state==="confirmed" && stoppedWrites===1,"DB 저장 중단 후 중복 쓰기");
  const late=await fixtureExternalExecution(db,"external-execution-late",now,"fixed-doc");let clock:number=now;let release:()=>void=()=>{throw new Error("지연 응답 미준비");};let started:()=>void=()=>{throw new Error("지연 호출 미준비");};const ready:Promise<void>=new Promise(resolve=>{started=resolve;});const delayed:Promise<void>=new Promise(resolve=>{release=resolve;});let lateWrites:number=0;
  const lateTransport:ExternalTransport={write:async context=>{lateWrites+=1;await late.request(context,"docs.documents.batchUpdate",clock);started();await delayed;return {externalId:"fixed-doc",providerRequestId:context.attemptId,status:200};},read:async context=>{await late.request(context,"docs.documents.get",clock);return {receipt:{id:context.attemptId,status:200},observation:{status:"available",externalId:"fixed-doc",content:{kind:"document",title:"fixed-report",text:"confirmed text",tabId:"t.0",documentTabCount:1}}};}};
  const lateRuntime:ExternalExecutionRuntime={...runtime,now:()=>clock};
  const old=runExternalOperation(db,late.owner,late.operationId,lateTransport,lateRuntime).then(()=>false,(error:unknown)=>{if(!(error instanceof Error)) throw error;return true;});await ready;clock+=30_001;
  const newer=await runExternalOperation(db,late.owner,late.operationId,lateTransport,lateRuntime);release();
  ensure(await old && newer.operation.state==="confirmed" && lateWrites===1 && (await readExternalOperation(db,late.owner,late.operationId)).state==="confirmed","늦은 실행이 복구 결과를 덮어씀");
  return ["one-request-write-or-verification-only", "received-response-not-confirmed-until-readback", "confirmed-operation-retained-without-calls", "lost-write-response-recovered-by-read-only", "write-and-verification-db-save-failures-no-repeat-write", "late-write-response-cannot-overwrite-newer-verification"];
}
