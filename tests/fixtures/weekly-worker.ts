import { checkGoogleReferences } from "./google-reference-checks";
import { checkGoogleCalendar } from "./google-calendar-checks";
import { checkGoogleReportSetup } from "./google-report-setup-checks";
import { readConfirmedGoogleReport } from "../../db/repositories/weekly-export";
import { confirmWeeklyWorkspace,readWeeklyFrozen } from "../../db/repositories/weekly-confirmation";
import { exportWeeklySummary } from "../../db/repositories/weekly";
import { weeklyBusinessKey } from "../../lib/weekly/confirmation";
import { createWeeklyWorkspace,readWeeklyWorkspace,saveWeeklyWorkspace,beginWeeklyAi,requireCurrentWeekly,setWeeklyTime,refreshWeeklyEvidence } from "../../db/repositories/weekly-workspace";
import { processWeeklyAi,dispatchWeekly } from "../../lib/weekly/processing";
import { roommateFixture } from "./weekly-roommate";
import { runLibrarianFixture } from "./librarian-worker";
import { learningRuntimeFixture } from "./learning-ai-runtime";
import { tutorOutputFixture } from "./tutor-output";
import { createTutor,getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction,submitStoredTutorAnswer } from "../../db/repositories/tutor-actions";
import { beginStoredTutorAi,processTutorAi,tutorContext,tutorRequest,dispatchTutor } from "../../lib/tutor/ai";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { weeklyAiContext,weeklyAiRequest } from "../../lib/weekly/ai";
import type { WeeklyPlanningContext,WeeklyProposal } from "../../lib/weekly/planning";
import { runAiRequest } from "../../lib/ai/run";
import { domainFailure } from "../../lib/domain/contracts";
import { readWeeklyContext } from "../../db/repositories/weekly-context";
import { supportedWeeklyClaims,requireWeeklyClaims } from "../../lib/weekly/claims";
import { readWeeklyEvidence } from "../../db/repositories/weekly-evidence";
import { applyCorrection } from "../../db/repositories/reviews";
import { recordId,seoulStudyDate } from "../../lib/domain/contracts";
import type { Command,SiteIdentity } from "../../lib/domain/contracts";
import { isDomainFailure } from "../../db/repositories/atomic";
import { checkWeeklyRecovery } from "./weekly-recovery-checks";
function check(value:boolean,message:string):void {if(!value) throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(isDomainFailure(error) && error.code===code) return;throw error;}throw new Error(`거부 누락: ${code}`);}
async function weeklyCounts(db:D1Database,owner:SiteIdentity):Promise<string> {
  const tables=["weekly_summaries","weekly_drafts","weekly_versions","weekly_evidence","weekly_snapshots","external_jobs","external_steps","external_attempts","atomic_requests","atomic_checks"];
  const rows=await db.batch(tables.map(table=>db.prepare(`SELECT * FROM ${table} WHERE owner_id=? ORDER BY rowid`).bind(owner.userId)));return JSON.stringify(rows.map(row=>row.results));
}
async function verify(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,scopeId:string):Promise<readonly string[]> {
  const id=():ReturnType<typeof recordId.parse>=>recordId.parse(crypto.randomUUID());const cmd=(expectedVersion:number):Command=>({owner,expectedVersion,requestKey:crypto.randomUUID()});
  const input={id:id(),scopeId,questionId:id(),attemptId:id()};await createTutor(db,bucket,cmd(1),input,Date.now());let state=await getTutor(db,owner,input.id);const courseId=state.start.bundle.unit.courseId;const date=seoulStudyDate(Date.now());
  await dispatchTutorAction(db,bucket,cmd(state.version),{action:"direct",id:input.id,expectedVersion:state.version},Date.now());
  await denied(()=>readWeeklyEvidence(db,owner,courseId,date),"reference_conflict");state=await getTutor(db,owner,input.id);
  await submitStoredTutorAnswer(db,bucket,cmd(state.version),input.id,id(),{text:"분수는 전체를 같은 크기로 나눈 것 중 선택한 부분입니다.",fileIds:[]},Date.now());
  check((await readWeeklyEvidence(db,owner,courseId,date)).aggregate.counts.sessions===0,"미확정 답안 집계");
  const ai=learningRuntimeFixture(db,owner,async()=>tutorContext(await getTutor(db,owner,input.id)),async()=>tutorOutputFixture(await getTutor(db,owner,input.id)));
  async function generate(action:"diagnose"|"variation"):Promise<void> {state=await getTutor(db,owner,input.id);await beginStoredTutorAi(db,bucket,cmd(state.version),input.id,action);state=await getTutor(db,owner,input.id);state=await processTutorAi(ai.runtime,bucket,owner,input.id,ai.pricing,tutorRequest(state,[]),dispatchTutor,new AbortController().signal);}
  await generate("diagnose");await generate("variation");await submitStoredTutorAnswer(db,bucket,cmd(state.version),input.id,id(),{text:"2/5",fileIds:[]},Date.now());await generate("diagnose");
  const snap=await readResultSnapshot(db,owner,input.id);await confirmSessionResult(db,cmd(state.version),{id:input.id,expectedVersion:state.version,expectedSessionVersion:snap.sessionVersion,expectedOfficialVersion:snap.draft.officialVersion,fingerprint:snap.draft.fingerprint},Date.now());
  const weekly=await readWeeklyEvidence(db,owner,courseId,date);check(weekly.aggregate.counts.sessions===1 && weekly.aggregate.counts.answers===2 && weekly.aggregate.counts.independentNewConditions===1 && weekly.aggregate.counts.delayedRecall===0,"확정 답안 집계 실패");
  check((await readWeeklyEvidence(db,owner,courseId,"2026-01-01")).aggregate.counts.answers===0,"빈 과거 주간 집계 실패");await denied(()=>readWeeklyEvidence(db,{realm:"sites",userId:"other"},courseId,date),"reference_conflict");
  const context=await readWeeklyContext(db,bucket,owner,courseId,date);check(context.sources.every(source=>source.valid),"실제 R2 출처 확인 누락");const sourceIds=context.sources.filter(source=>source.valid).map(source=>source.id);const claims=supportedWeeklyClaims(context.snapshot.aggregate,sourceIds);requireWeeklyClaims(claims,context.snapshot.aggregate,sourceIds);check(claims.length===2,"확정 설명·새 과제 주장 누락");
  const planning:WeeklyPlanningContext={aggregate:context.snapshot.aggregate,units:[state.start.bundle.unit],sources:context.sources.flatMap(source=>source.source ? [source.source] : []),availableMinutes:30};
  const independent=claims.find(claim=>claim.kind==="independent-new-condition");if(!independent) throw new Error("주간 계획 독립 근거 누락");
  const proposal:WeeklyProposal={kind:"weekly-review",claimIds:claims.map(claim=>claim.id),items:[{unitId:state.start.bundle.unit.unitId,targetUnitId:state.start.bundle.unit.unitId,action:"increase-difficulty",estimatedMinutes:20,activity:"새 조각 조건을 직접 설명하기",claimIds:[independent.id]}],roommate:roommateFixture(state.start.bundle.unit.unitId,planning.sources),uncertainty:["예상 시간과 난도는 실제 수행으로 확인해요."],requiresConfirmation:true};
  const planAi=learningRuntimeFixture(db,owner,async()=>weeklyAiContext(planning),async()=>proposal);const planRequest={logicalRequestKey:crypto.randomUUID(),request:weeklyAiRequest(planning),pricing:planAi.pricing,expectedKind:"weekly-review" as const};
  const generated=await runAiRequest(planAi.runtime,planRequest,new AbortController().signal);check(generated.kind==="validated" && generated.output.result.kind==="weekly-review","주간 AI 구조·근거 검증 실패");
  const duplicate=await runAiRequest(planAi.runtime,planRequest,new AbortController().signal);check(duplicate.kind==="existing" && planAi.generations()===1,"주간 생성 중복 호출");
  await denied(()=>runAiRequest({...planAi.runtime,checkFunding:async()=>{throw domainFailure("limit_exceeded","weekly.fixture-budget",null);}}, {...planRequest,logicalRequestKey:crypto.randomUUID()},new AbortController().signal),"limit_exceeded");check(planAi.generations()===1,"예산 차단 후 모델 호출");
  const weeklyId=id();const startCmd=cmd(1);const start={id:weeklyId,courseId,date,availableMinutes:30};
  await createWeeklyWorkspace(db,bucket,startCmd,start);await createWeeklyWorkspace(db,bucket,startCmd,start);
  const started=await readWeeklyWorkspace(db,owner,weeklyId);check(started.version===1 && started.phase==="draft","주간 초안 생성·멱등 실패");
  await denied(()=>readWeeklyWorkspace(db,{realm:"sites",userId:"other"},weeklyId),"reference_conflict");
  const generateCmd=cmd(1);await beginWeeklyAi(db,bucket,generateCmd,weeklyId);await beginWeeklyAi(db,bucket,generateCmd,weeklyId);
  const pending=await readWeeklyWorkspace(db,owner,weeklyId);const savedAi=learningRuntimeFixture(db,owner,async()=>weeklyAiContext(pending.context),async()=>proposal);
  const proposed=await processWeeklyAi(savedAi.runtime,bucket,owner,weeklyId,savedAi.pricing,dispatchWeekly,new AbortController().signal);
  const recovered=await processWeeklyAi(savedAi.runtime,bucket,owner,weeklyId,savedAi.pricing,dispatchWeekly,new AbortController().signal);
  check(proposed.version===3 && proposed.phase==="proposed" && recovered.version===3 && savedAi.generations()===1,"주간 생성·재조회 중복 호출");
  const edit={availableMinutes:10,proposal,notes:"다음 주 실제 시간은 짧아요."};const editCmd=cmd(proposed.version);
  await saveWeeklyWorkspace(db,bucket,editCmd,weeklyId,edit);await saveWeeklyWorkspace(db,bucket,editCmd,weeklyId,edit);
  const edited=await readWeeklyWorkspace(db,owner,weeklyId);check(edited.version===4 && edited.notes===edit.notes && edited.context.availableMinutes===10 && edited.proposal?.roommate.facts[0].status==="source-checked","주간 편집·사실/비유 저장 실패");
  await denied(()=>saveWeeklyWorkspace(db,bucket,cmd(3),weeklyId,edit),"version_conflict");
  await denied(()=>saveWeeklyWorkspace(db,bucket,cmd(4),weeklyId,{...edit,proposal:{...proposal,claimIds:["invented-achievement"]}}),"reference_conflict");
  await setWeeklyTime(db,bucket,cmd(4),weeklyId,0);check((await readWeeklyWorkspace(db,owner,weeklyId)).context.availableMinutes===0,"주간 0분 구분 실패");
  const ready=await readWeeklyWorkspace(db,owner,weeklyId);const confirmation={id:weeklyId,expectedVersion:ready.version,businessKey:weeklyBusinessKey(ready),fingerprint:ready.fingerprint};const before=await weeklyCounts(db,owner);
  await denied(()=>confirmWeeklyWorkspace(db,bucket,cmd(ready.version),{...confirmation,fingerprint:"f".repeat(64)},Date.now()),"version_conflict");
  for(const table of ["weekly_versions","weekly_evidence","external_jobs","external_steps","weekly_snapshots"]) {
    await db.prepare(`CREATE TRIGGER weekly_failure BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'weekly_failure'); END`).run();await denied(()=>confirmWeeklyWorkspace(db,bucket,cmd(ready.version),confirmation,Date.now()),"reference_conflict");await db.prepare("DROP TRIGGER weekly_failure").run();check(await weeklyCounts(db,owner)===before,`주간 부분 커밋: ${table}`);
  }
  await db.prepare("CREATE TRIGGER weekly_zero BEFORE UPDATE ON weekly_summaries BEGIN SELECT RAISE(IGNORE); END").run();await denied(()=>confirmWeeklyWorkspace(db,bucket,cmd(ready.version),confirmation,Date.now()),"version_conflict");await db.prepare("DROP TRIGGER weekly_zero").run();check(await weeklyCounts(db,owner)===before,"주간 0행 갱신 부분 커밋");
  await db.prepare("CREATE TRIGGER weekly_race BEFORE INSERT ON atomic_requests WHEN NEW.scope='weekly.workspace-confirm' BEGIN UPDATE review_items SET version=version+1; END").run();await denied(()=>confirmWeeklyWorkspace(db,bucket,cmd(ready.version),confirmation,Date.now()),"version_conflict");await db.prepare("DROP TRIGGER weekly_race").run();check(await weeklyCounts(db,owner)===before,"주간 근거 경쟁 부분 커밋");
  const competing=[cmd(ready.version),cmd(ready.version)];const races=await Promise.allSettled(competing.map(command=>confirmWeeklyWorkspace(db,bucket,command,confirmation,Date.now())));check(races.filter(result=>result.status==="fulfilled").length===1,"주간 동시 확정 중복");const winner=competing[races.findIndex(result=>result.status==="fulfilled")];
  const confirmed=await readWeeklyWorkspace(db,owner,weeklyId);if(!confirmed.confirmedVersionId) throw new Error("주간 확정본 ID 누락");const frozenId=confirmed.confirmedVersionId;const after=await weeklyCounts(db,owner);await confirmWeeklyWorkspace(db,bucket,winner,confirmation,Date.now());check(await weeklyCounts(db,owner)===after,"주간 응답 유실 재전송 중복");
  const frozen=await readWeeklyFrozen(db,bucket,owner,frozenId);check(frozen.state.phase==="confirmed" && frozen.exportState==="pending" && frozen.current,"주간 불변본·내보내기 요청 연결 실패");const exported=await exportWeeklySummary(db,owner,frozenId);check(!JSON.stringify(exported).includes(edit.notes) && !JSON.stringify(exported).includes(weekly.aggregate.answers[0].text) && exported.nextActions.includes("배정 0분"),"내보내기에 대화·답안 포함 또는 시간 배정 오류");
  const googleReport=await readConfirmedGoogleReport(db,bucket,owner,frozenId);check(googleReport.versionId===frozenId && googleReport.content.nextActions===exported.nextActions,"Google 확정 요약 매핑 불일치");
  await denied(()=>readConfirmedGoogleReport(db,bucket,{realm:"sites",userId:"other"},frozenId),"reference_conflict");
  await denied(()=>readConfirmedGoogleReport(db,bucket,owner,id()),"reference_conflict");
  check(await weeklyCounts(db,owner)===after,"Google 미연결 자료 조회가 내부 확정 기록 변경");
  check(await db.prepare("SELECT count(*) FROM external_steps s JOIN external_jobs j ON j.owner_id=s.owner_id AND j.id=s.job_id WHERE j.owner_id=? AND j.weekly_version_id=? AND s.state='pending'").bind(owner.userId,frozenId).first<number>("count(*)")===2,"추가 승인 없는 두 내보내기 단계 누락");
  for(const sql of ["UPDATE weekly_snapshots SET fingerprint='changed' WHERE owner_id=?","DELETE FROM weekly_snapshots WHERE owner_id=?"]) {let refused=false;try{await db.prepare(sql).bind(owner.userId).run();}catch(error:unknown){if(!(error instanceof Error) || !error.message.includes("immutable_weekly_snapshot")) throw error;refused=true;}check(refused,"주간 불변본 변경 허용");}
  await db.prepare("UPDATE cost_windows SET limit_units=settled_units+reserved_units WHERE owner_id=? AND category='ai'").bind(owner.userId).run();
  const budgetBefore=await db.prepare("SELECT id,version,limit_units,reserved_units,settled_units FROM cost_windows WHERE owner_id=? AND category='ai' ORDER BY id").bind(owner.userId).all();
  check(budgetBefore.results.length>0,"AI 한도 시험 원장 없음");
  await denied(()=>runAiRequest(planAi.runtime,{...planRequest,logicalRequestKey:crypto.randomUUID()},new AbortController().signal),"limit_exceeded");
  check(planAi.generations()===1,"저장된 AI 한도 차단 후 모델 생성 발생");
  const setupChecks=await checkGoogleReportSetup(db,bucket,owner,googleReport);
  const budgetAfter=await db.prepare("SELECT id,version,limit_units,reserved_units,settled_units FROM cost_windows WHERE owner_id=? AND category='ai' ORDER BY id").bind(owner.userId).all();
  check(JSON.stringify(budgetAfter.results)===JSON.stringify(budgetBefore.results),"Google 내보내기가 AI 한도·원장을 변경함");
  const review=weekly.aggregate.reviews[0];if(!review) throw new Error("복습 정정 대상 누락");
  await applyCorrection(db,cmd(1),{id:id(),errorId:review.errorId,concept:review.concept,sourceRefId:state.start.bundle.sources[0].id,answerId:review.answerId,studyDate:date,createdAt:Date.now(),reason:"주간 근거 정정 검사",evidence:state.start.bundle.sources[0].evidence,targets:[{reviewId:review.id,expectedVersion:review.version,question:"새 조건에서 다시 확인",explanation:"정정 설명",nextAction:"수정 근거로 재검증"}]});
  const corrected=await readWeeklyEvidence(db,owner,courseId,date);check(corrected.aggregate.answers.every(answer=>answer.needsRecheck) && corrected.aggregate.counts.independentNewConditions===0 && corrected.revision!==weekly.revision,"정정 뒤 주간 근거 재검증 누락");
  const correctedContext=await readWeeklyContext(db,bucket,owner,courseId,date);await denied(async()=>requireWeeklyClaims(claims,correctedContext.snapshot.aggregate,sourceIds),"reference_conflict");check(correctedContext.fingerprint!==context.fingerprint,"주장 근거 지문 갱신 누락");
  await denied(()=>requireCurrentWeekly(db,bucket,owner,edited),"version_conflict");
  await denied(()=>saveWeeklyWorkspace(db,bucket,cmd(5),weeklyId,edit),"version_conflict");
  await refreshWeeklyEvidence(db,bucket,cmd((await readWeeklyWorkspace(db,owner,weeklyId)).version),weeklyId);const refreshed=await readWeeklyWorkspace(db,owner,weeklyId);check(refreshed.phase==="draft" && refreshed.proposal===null && refreshed.claims.length===0 && refreshed.notes===edit.notes,"정정 후 초안 근거 새로 읽기 실패");
  const oldFrozen=await readWeeklyFrozen(db,bucket,owner,frozenId);check(!oldFrozen.current && oldFrozen.state.claims.length===confirmed.claims.length,"정정 뒤 이전 확정본 재검증 표시·보존 실패");
  await denied(()=>readConfirmedGoogleReport(db,bucket,owner,frozenId),"version_conflict");
  const recoveryChecks=await checkWeeklyRecovery(db,bucket,owner,weeklyId);
  return [...recoveryChecks,"weekly-stored-ai-cap-blocks-generation-but-google-export-and-readback-succeed-with-ledger-unchanged",...setupChecks,...await checkGoogleCalendar(db),...await checkGoogleReferences(db,bucket),"google-report-confirmed-only-owner-latest-and-no-connection-preserves-records","weekly-confirmation-export-atomic-five-failures-rollback","weekly-zero-update-and-evidence-race-rollback","weekly-concurrent-confirmation-one-version-outbox","weekly-export-allowlist-no-extra-approval","weekly-immutable-snapshot-correction-recheck","weekly-draft-edit-reload-version-conflict","weekly-ai-saved-result-recovery-no-duplicate","weekly-correction-stale-draft-blocked","weekly-real-sdk-mock-plan-budget-and-idempotency","weekly-current-r2-sources-and-claim-evidence","weekly-correction-invalidates-old-claims","weekly-actual-confirmed-event-answer-version-joined","weekly-unconfirmed-and-empty-week-excluded","weekly-owner-and-hidden-recall-denied","weekly-independent-and-delayed-separated","weekly-correction-rechecks-and-revision-changed"];
}
async function fetch(request:Request,env:Readonly<{DB:D1Database;BUCKET:R2Bucket}>):Promise<Response>{try{return await runLibrarianFixture(request,env,verify);}catch(error:unknown){if(!(error instanceof Error)) throw error;const causes:string[]=[];let current:unknown=error;while(current instanceof Error){causes.push(current.stack??current.message);current=current.cause;}return Response.json({causes,...("diagnostic" in error?{diagnostic:error.diagnostic}:{}),...("code" in error?{code:error.code}:{})},{status:500});}}
const worker={fetch};export default worker;
