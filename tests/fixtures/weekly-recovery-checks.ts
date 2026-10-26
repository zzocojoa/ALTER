import type { Command,SiteIdentity } from "../../lib/domain/contracts";
import { weeklyAiContext } from "../../lib/weekly/ai";
import { processWeeklyAi,dispatchWeekly } from "../../lib/weekly/processing";
import { weeklyRecoveryDecision } from "../../lib/weekly/recovery";
import type { WeeklyWorkspace } from "../../lib/weekly/workspace";
import type { WeeklyProposal } from "../../lib/weekly/planning";
import { beginWeeklyAi,readWeeklyWorkspace,saveWeeklyAi,saveWeeklyWorkspace } from "../../db/repositories/weekly-workspace";
import { resetWeeklyGeneration } from "../../db/repositories/weekly-generation";
import { readAiRequestStatus } from "../../db/repositories/ai-status";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import type { RuntimeFixture } from "./learning-ai-runtime";
import { roommateFixture } from "./weekly-roommate";

function check(value:boolean,message:string):void {if(!value) throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(error instanceof Error && "code" in error && error.code===code) return;throw error;}throw new Error(`거부 누락: ${code}`);}
function proposalFor(state:WeeklyWorkspace):WeeklyProposal {const unit=state.context.units[0];return {kind:"weekly-review",claimIds:[],items:[{unitId:unit.unitId,targetUnitId:unit.unitId,action:"gather-evidence",estimatedMinutes:10,activity:"새 답안으로 현재 수행을 확인하기",claimIds:[]}],roommate:roommateFixture(unit.unitId,state.context.sources),uncertainty:["시험 주간의 실제 성과는 미확인"],requiresConfirmation:true};}
async function ledger(db:D1Database,owner:SiteIdentity):Promise<string> {
  const tables=["ai_calls","ai_cost_intents","cost_reservations","cost_windows","ai_budget_blocks"];
  const rows=await db.batch(tables.map(table=>db.prepare(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY rowid`).bind(owner.userId)));
  return JSON.stringify(rows.map(row=>row.results));
}

/** 실제 비용 예약 배치와 초기화를 양쪽 순서로 경쟁시키되 외부 전송은 SDK 모의 응답만 사용합니다. */
export async function checkWeeklyRecovery(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,weeklyId:string):Promise<readonly string[]> {
  const cmd=(expectedVersion:number):Command=>({owner,expectedVersion,requestKey:crypto.randomUUID()});
  await db.prepare("UPDATE cost_windows SET limit_units=MAX(limit_units,settled_units+reserved_units+1000000000) WHERE owner_id=? AND category='ai'").bind(owner.userId).run();
  async function prepare():Promise<WeeklyWorkspace> {
    const id=weeklyId;const draft=await readWeeklyWorkspace(db,owner,id);await saveWeeklyWorkspace(db,bucket,cmd(draft.version),id,{availableMinutes:21,proposal:proposalFor(draft),notes:"초기화 뒤에도 남아야 하는 사용자 메모"});
    await beginWeeklyAi(db,bucket,cmd(draft.version+1),id);return readWeeklyWorkspace(db,owner,id);
  }
  function aiFor(state:WeeklyWorkspace):RuntimeFixture {return learningRuntimeFixture(db,owner,async()=>weeklyAiContext(state.context),async()=>proposalFor(state));}
  async function run(state:WeeklyWorkspace,ai:RuntimeFixture):Promise<WeeklyWorkspace> {return processWeeklyAi(ai.runtime,bucket,owner,state.id,ai.pricing,dispatchWeekly,new AbortController().signal);}

  const beforeReservation=await prepare();const firstAi=aiFor(beforeReservation);const counting=Promise.withResolvers<void>();const countRelease=Promise.withResolvers<void>();
  const pausedCount:RuntimeFixture={...firstAi,runtime:{...firstAi.runtime,fetch:async(input,init)=>{if(new Request(input,init).url.endsWith("/input_tokens")){counting.resolve();await countRelease.promise;}return firstAi.runtime.fetch(input,init);}}};
  const before=await ledger(db,owner);const oldRun=run(beforeReservation,pausedCount).then(value=>({value,error:null}),(error:unknown)=>({value:null,error}));
  await counting.promise;const resetCommand=cmd(beforeReservation.version);const reset=await resetWeeklyGeneration(db,bucket,resetCommand,beforeReservation.id);
  check(JSON.stringify(await resetWeeklyGeneration(db,bucket,resetCommand,beforeReservation.id))===JSON.stringify(reset),"초기화 재전송 영수증 불일치");
  countRelease.resolve();await denied(async()=>{const result=await oldRun;if(result.error) throw result.error;},"version_conflict");
  check(firstAi.generations()===0 && await ledger(db,owner)===before,"초기화 뒤 구 실행이 비용 예약 또는 AI 전송함");
  const reopened=await readWeeklyWorkspace(db,owner,beforeReservation.id);check(reopened.phase==="draft" && reopened.pendingKey===null && reopened.notes===beforeReservation.notes && reopened.context.availableMinutes===21,"예약 전 초기화가 메모·시간 또는 초안 복구 실패");
  await denied(()=>resetWeeklyGeneration(db,bucket,{...cmd(beforeReservation.version),owner:{realm:"sites",userId:"other"}},beforeReservation.id),"reference_conflict");
  await beginWeeklyAi(db,bucket,{owner,expectedVersion:beforeReservation.version-1,requestKey:beforeReservation.pendingKey!.split(":").at(-1)!},beforeReservation.id);
  check((await run(beforeReservation,firstAi)).phase==="draft" && firstAi.generations()===0 && await ledger(db,owner)===before,"초기화 전 생성 요청키가 새 전송을 시작함");
  await beginWeeklyAi(db,bucket,cmd(reopened.version),reopened.id);const explicit=await readWeeklyWorkspace(db,owner,reopened.id);const explicitAi=aiFor(explicit);check((await run(explicit,explicitAi)).phase==="proposed" && explicitAi.generations()===1,"명시적 새 생성 실패");

  const afterReservation=await prepare();const secondAi=aiFor(afterReservation);const countStarted=Promise.withResolvers<void>();const reserveRelease=Promise.withResolvers<void>();const sending=Promise.withResolvers<void>();const sendRelease=Promise.withResolvers<void>();
  const pausedSend:RuntimeFixture={...secondAi,runtime:{...secondAi.runtime,fetch:async(input,init)=>{const url=new Request(input,init).url;if(url.endsWith("/input_tokens")){countStarted.resolve();await reserveRelease.promise;}if(url.endsWith("/responses")){sending.resolve();await sendRelease.promise;}return secondAi.runtime.fetch(input,init);}}};
  const pendingRun=run(afterReservation,pausedSend);await countStarted.promise;
  const atomicStatements=new WeakSet<D1PreparedStatement>();
  const racingDb:D1Database=new Proxy(db,{get(target,property):unknown {
    if(property==="prepare") return (sql:string):D1PreparedStatement=>{const statement=target.prepare(sql);if(!sql.startsWith("INSERT INTO atomic_requests ")) return statement;return new Proxy(statement,{get(prepared,key):unknown {if(key==="bind") return (...values:unknown[]):D1PreparedStatement=>{const bound=prepared.bind(...values);atomicStatements.add(bound);return bound;};const value:unknown=Reflect.get(prepared,key);return typeof value==="function" ? value.bind(prepared) : value;}});};
    if(property==="batch") return async <T>(statements:D1PreparedStatement[]):Promise<D1Result<T>[]>=>{if(atomicStatements.has(statements[0])){reserveRelease.resolve();await sending.promise;}return target.batch<T>(statements);};const value:unknown=Reflect.get(target,property);return typeof value==="function" ? value.bind(target) : value;
  }});
  await denied(()=>resetWeeklyGeneration(racingDb,bucket,cmd(afterReservation.version),afterReservation.id),"version_conflict");const reserved=await ledger(db,owner);
  await denied(()=>resetWeeklyGeneration(db,bucket,cmd(afterReservation.version),afterReservation.id),"result_unknown");check(await ledger(db,owner)===reserved,"진행 중 예약을 초기화하면서 원장 변경");
  sendRelease.resolve();check((await pendingRun).phase==="proposed" && secondAi.generations()===1,"선행 예약 요청의 정상 완료 실패");

  const invalid=await prepare();const invalidAi=learningRuntimeFixture(db,owner,async()=>weeklyAiContext(invalid.context),async()=>({...proposalFor(invalid),claimIds:["invented-achievement"]}));
  await denied(()=>run(invalid,invalidAi),"ai_semantic_invalid");const invalidBefore=await ledger(db,owner);
  await denied(()=>run(invalid,invalidAi),"result_unknown");await resetWeeklyGeneration(db,bucket,cmd(invalid.version),invalid.id);
  const invalidReset=await readWeeklyWorkspace(db,owner,invalid.id);check(invalidReset.notes===invalid.notes && invalidReset.phase==="draft" && invalidAi.generations()===1 && await ledger(db,owner)===invalidBefore,"검증 실패 초기화가 비용·실패 이력·메모를 바꿈");
  await denied(()=>saveWeeklyAi(db,bucket,owner,invalid,proposalFor(invalid)),"version_conflict");
  await saveWeeklyWorkspace(db,bucket,cmd(invalidReset.version),invalid.id,{availableMinutes:21,proposal:proposalFor(invalidReset),notes:invalidReset.notes});

  const stale=await prepare();const staleAi=aiFor(stale);
  await db.prepare(`CREATE TRIGGER weekly_recovery_save_fail BEFORE UPDATE ON weekly_drafts WHEN OLD.summary_id='${stale.id}' BEGIN SELECT RAISE(ABORT,'weekly_recovery_save_fail'); END`).run();
  await denied(()=>run(stale,staleAi),"reference_conflict");await db.prepare("DROP TRIGGER weekly_recovery_save_fail").run();
  const statuses=await readAiRequestStatus(db,owner,stale.pendingKey!);check(statuses.length===1 && statuses[0].stage==="validated" && !weeklyRecoveryDecision(stale,true,statuses).allowed,"현재 검증 응답을 복구 대신 초기화함");
  await denied(()=>resetWeeklyGeneration(db,bucket,cmd(stale.version),stale.id),"result_unknown");
  await db.prepare("UPDATE units SET version=version+1 WHERE owner_id=? AND id=?").bind(owner.userId,stale.context.units[0].unitId).run();
  const staleBefore=await ledger(db,owner);await resetWeeklyGeneration(db,bucket,cmd(stale.version),stale.id);const fresh=await readWeeklyWorkspace(db,owner,stale.id);
  check(fresh.phase==="draft" && fresh.fingerprint!==stale.fingerprint && fresh.notes===stale.notes && await ledger(db,owner)===staleBefore,"근거 변경 초기화가 최신 근거·메모·원장을 보존하지 못함");
  await denied(()=>saveWeeklyAi(db,bucket,owner,stale,proposalFor(stale)),"version_conflict");
  const unknown=await prepare();const unknownAi=aiFor(unknown);const refused:RuntimeFixture={...unknownAi,runtime:{...unknownAi.runtime,fetch:async(input,init)=>new Request(input,init).url.endsWith("/responses") ? Response.json({error:{message:"시험용 전송 결과 미확정",type:"invalid_request_error",code:"fixture_failure"}},{status:400}) : unknownAi.runtime.fetch(input,init)}};
  await denied(()=>run(unknown,refused),"ai_transport_failed");const unknownBefore=await ledger(db,owner);
  await denied(()=>resetWeeklyGeneration(db,bucket,cmd(unknown.version),unknown.id),"result_unknown");await denied(()=>beginWeeklyAi(db,bucket,cmd(unknown.version),unknown.id),"version_conflict");
  check(await ledger(db,owner)===unknownBefore && (await readWeeklyWorkspace(db,owner,unknown.id)).pendingKey===unknown.pendingKey,"결과 불명 요청의 초기화·재실행 우회");
  return ["weekly-reset-before-reservation-atomic-guard-no-charge-no-dispatch","weekly-reservation-before-reset-blocks-reset","weekly-reservation-between-status-and-reset-batch-rolls-back","weekly-reset-old-generate-key-no-new-call","weekly-reset-other-owner-denied","weekly-reset-idempotent-notes-time-preserved","weekly-invalid-settled-reset-keeps-cost-failure-records","weekly-reset-late-response-cas-rejected","weekly-unknown-reservation-reset-regenerate-denied","weekly-stale-confirmed-response-reset-current-evidence"];
}
