import { fixtureExternalExecution } from "./external-execution-checks.ts";
import { claimExternalWrite,operationLease,readExternalOperation } from "../../db/repositories/external-operation.ts";
import { recordExternalIntent } from "../../db/repositories/external-progress.ts";
import { runExternalOperation } from "../../lib/external/execute.ts";
import type { ExternalExecutionRuntime,ExternalTransport } from "../../lib/external/execute.ts";
import { recordId } from "../../lib/domain/contracts.ts";
import { externalVerification } from "../../lib/external/verification.ts";

function ensure(value:boolean,label:string):void {if(!value) throw new Error(label);}
async function rejected(run:()=>Promise<unknown>):Promise<void> {try{await run();}catch(error:unknown){if(error instanceof Error) return;throw error;}throw new Error("금지된 복구가 허용됐습니다.");}
export async function checkExternalRecovery(db:D1Database):Promise<readonly string[]> {
  let now:number=Date.parse("2026-10-25T02:00:00Z");const runtime:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),warn:()=>{},jitter:()=>0,requestBudgetMs:30_000};
  const unsent=await fixtureExternalExecution(db,"external-unsent-owner",now,"fixed-doc");
  const original=await claimExternalWrite(db,unsent.owner,{operationId:recordId.parse(unsent.operationId),expectedVersion:1,leaseId:recordId.parse(crypto.randomUUID()),attemptId:recordId.parse(crypto.randomUUID()),now,leaseUntil:now+30_000});
  await rejected(()=>db.prepare("UPDATE external_operations SET state='pending',lease_id=NULL,lease_until=NULL WHERE owner_id=? AND id=?").bind(unsent.owner.userId,unsent.operationId).run());
  now+=30_001;let writes:number=0;let reads:number=0;
  const transport:ExternalTransport={write:async context=>{writes+=1;await unsent.request(context,"docs.documents.batchUpdate",now);return {externalId:"fixed-doc",providerRequestId:context.attemptId,status:200};},read:async()=>{reads+=1;return {receipt:null,observation:{status:"unavailable",reason:"not-found"}};}};
  const proven=await runExternalOperation(db,unsent.owner,unsent.operationId,transport,runtime);
  ensure(proven.operation.state==="pending" && externalVerification.parse(JSON.parse(proven.operation.verification??"{}")).status==="not-executed" && writes===0 && reads===0,"미전송 증명 누락 또는 외부 재조회 발생");
  await rejected(()=>recordExternalIntent(db,unsent.owner,operationLease(original),now));
  await runExternalOperation(db,unsent.owner,unsent.operationId,transport,runtime);
  ensure(writes===1,"미전송 증명 이후 첫 쓰기 실패");
  await runExternalOperation(db,unsent.owner,unsent.operationId,transport,runtime);
  let missing=await readExternalOperation(db,unsent.owner,unsent.operationId);
  ensure(missing.state==="unknown" && missing.intentAt!==null,"미발견을 미전송으로 처리");
  now=missing.nextAttemptAt;await runExternalOperation(db,unsent.owner,unsent.operationId,transport,runtime);missing=await readExternalOperation(db,unsent.owner,unsent.operationId);
  ensure(writes===1 && reads===2 && missing.state==="unknown","검색 지연 또는 한도 시각 도달에 중복 쓰기");
  const noId=await fixtureExternalExecution(db,"external-missing-id-owner",now,null);let unknownWrites:number=0;
  const missingIdTransport:ExternalTransport={write:async()=>{unknownWrites+=1;throw new TypeError("생성 반영 후 응답 유실");},read:async context=>{await noId.request(context,"docs.documents.get",now);return {receipt:{id:context.attemptId,status:200},observation:{status:"available",externalId:"title-only-candidate",content:{kind:"document",title:"fixed-report",text:"confirmed text",tabId:"t.0",documentTabCount:1}}};}};
  await rejected(()=>runExternalOperation(db,noId.owner,noId.operationId,missingIdTransport,runtime));
  const unknown=await runExternalOperation(db,noId.owner,noId.operationId,missingIdTransport,runtime);
  ensure(unknown.operation.state==="unknown" && unknown.operation.externalId===null && unknownWrites===1,"식별 불가 생성 응답을 제목 후보로 확정");
  const proof=externalVerification.safeParse({status:"not-executed",basis:"durable-intent-absent-and-fenced",priorEpoch:2,fencedEpoch:2,checkedAt:now});ensure(!proof.success,"같은 선점 버전을 지연 실행 차단 증거로 수용");
  return ["missing-intent-and-new-epoch-prove-no-send", "old-execution-cannot-record-intent-after-fence", "missing-readback-never-repeats-known-write", "unknown-create-id-never-adopts-title-candidate"];
}
