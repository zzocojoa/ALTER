import { z } from "zod";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleQuota } from "./google-quota.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { executeGoogleRestAttempt } from "../../lib/google/execute.ts";
import type { GoogleExecutionSettings,GoogleExecutionRuntime } from "../../lib/google/execute.ts";
import { saveGoogleStorageObservation } from "../../db/repositories/google-observations.ts";
import { readGoogleCalendarSetup,createGoogleCalendarSetup,createGoogleSchedule,readGoogleSchedule } from "../../db/repositories/google-calendar.ts";
import { googleStudySchedule } from "../../lib/google-calendar/contract.ts";
import { googleExternalTransport } from "../../lib/external/google-adapter.ts";
import { readExternalWorkflowView,resumeExternalWorkflow } from "../../lib/external/resume.ts";
import type { ExternalExecutionRuntime } from "../../lib/external/execute.ts";
import { readGoogleResource } from "../../db/repositories/google-resources.ts";

function ensure(value:boolean,message:string):void {if(!value) throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(error instanceof Error && ("code" in error && error.code===code || error.name===code)) return;throw error;}throw new Error(`거부 누락: ${code}`);}
export async function checkGoogleCalendar(db:D1Database):Promise<readonly string[]> {
  let now=Date.now();const fixed=await fixtureGoogleConnection(db,"calendar-owner",now);const owner=fixed.owner;
  const base=fixtureGoogleQuota(owner.userId,now,10000,10000);
  const quota=googleQuotaPolicy.parse({...base,apis:["drive","docs","sheets","calendar"].map(api=>({...base.apis[0],api,dimensions:base.apis[0].dimensions.map(d=>({...d,metric:"request-minute",unit:"requests",actions:["read","write","create"]}))})),methods:Object.entries(googleMethodPolicies).filter(([method])=>method!=="picker.open").map(([method,policy])=>({method,source:policy.source,costs:[{metric:"request-minute",scope:"project",units:1},{metric:"request-minute",scope:"user",units:1}]}))});
  const settings:GoogleExecutionSettings={credentials:{clientId:fixtureGoogleOAuth(now).clientId,clientSecret:"fixed-secret",keyring:fixed.keyring},project:{...fixtureGoogleProject(now),ownerId:owner.userId,projectId:quota.projectId,consoleSource:`https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}`},quota};
  const calendarId="alter-schedule@group.calendar.google.com";let requests=0;let calendarCreates=0;let eventCreates=0;let eventUpdates=0;let calendarMissing=false;const events=new Map<string,Record<string,unknown>>();
  const runtime:GoogleExecutionRuntime={oauth:{fetch:async()=>{throw new Error("예상하지 않은 OAuth");},now:()=>now,wait:async()=>{throw new Error("대기 실행");},warn:()=>{}},rest:{now:()=>now,wait:async()=>{throw new Error("대기 실행");},warn:()=>{},fetch:async(raw,init)=>{
    requests+=1;const path=new URL(raw).pathname;
    if(path==="/drive/v3/about") return Response.json({storageQuota:{limit:"100000000",usage:"0"}});
    if(path==="/calendar/v3/calendars"){calendarCreates+=1;ensure(z.object({summary:z.literal("ALTER 학습 일정"),timeZone:z.literal("Asia/Seoul")}).safeParse(JSON.parse(String(init.body))).success,"캘린더 생성 입력 불일치");return Response.json({id:calendarId});}
    if(path.endsWith("/events")){eventCreates+=1;const body=z.record(z.unknown()).parse(JSON.parse(String(init.body)));const id=z.string().parse(body.id);events.set(id,{...body,etag:'"v1"'});throw new TypeError("시험 일정 반영 후 응답 유실");}
    if(path.includes("/events/")){const id=path.split("/").at(-1)??"";const existing=events.get(id);if(!existing) return Response.json({error:{errors:[{reason:"notFound"}]}},{status:404});if(init.method==="PUT"){eventUpdates+=1;ensure(new Headers(init.headers).get("if-match")===existing.etag,"이벤트 revision 누락");const body=z.record(z.unknown()).parse(JSON.parse(String(init.body)));events.set(id,{...body,id,etag:'"v2"'});throw new TypeError("시험 일정 갱신 후 응답 유실");}return Response.json(existing);}
    if(path===`/calendar/v3/calendars/${encodeURIComponent(calendarId)}`) return calendarMissing?Response.json({error:{errors:[{reason:"notFound"}]}},{status:404}):Response.json({id:calendarId,summary:"ALTER 학습 일정",timeZone:"Asia/Seoul"});
    throw new Error("예상하지 않은 일정 API 경로");
  }}};
  const probe=await executeGoogleRestAttempt(db,owner,settings,{method:"drive.about.get"},{id:crypto.randomUUID(),role:"account",storageUpperBytes:0,selection:null,context:null},runtime);await saveGoogleStorageObservation(db,owner,fixed.connection,probe.attemptId,quota.projectId,probe.data,now);
  const execution:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),warn:()=>{},jitter:()=>0,requestBudgetMs:60_000};const transport=googleExternalTransport(db,owner,settings,runtime);
  const setupRaces=await Promise.all([createGoogleCalendarSetup(db,owner,"calendar-setup-a",now),createGoogleCalendarSetup(db,owner,"calendar-setup-b",now)]);const setup=setupRaces[0];if(!setup.workflow) throw new Error("캘린더 작업 없음");ensure(setup.workflow.id===setupRaces[1].workflow?.id,"동시 캘린더 중복");
  const schedule=googleStudySchedule.parse({kind:"study",version:1,firstDate:"2026-10-25",startTime:"23:50",durationMinutes:30,weekdays:["SU","WE"],repeatWeeks:2});
  await denied(()=>createGoogleSchedule(db,owner,"before-calendar",schedule,now),"result_unknown");
  await resumeExternalWorkflow(db,owner,setup.workflow.id,transport,execution);await resumeExternalWorkflow(db,owner,setup.workflow.id,transport,execution);ensure((await readGoogleCalendarSetup(db,owner)).calendarId===calendarId && calendarCreates===1,"캘린더 재조회·식별자 저장 실패");
  await denied(()=>readGoogleResource(db,owner,fixed.connection,"primary","calendar-target"),"ZodError");await denied(()=>readGoogleCalendarSetup(db,{realm:"sites",userId:"other-owner"}),"reference_conflict");
  const races=await Promise.all([createGoogleSchedule(db,owner,"schedule-a",schedule,now),createGoogleSchedule(db,owner,"schedule-b",schedule,now)]);const created=races[0];const repeated=races[1];ensure(created.workflow.id===repeated.workflow.id,"같은 일정 중복");
  await denied(()=>createGoogleSchedule(db,owner,"schedule-changed",{...schedule,durationMinutes:35},now),"version_conflict");
  await resumeExternalWorkflow(db,owner,created.workflow.id,transport,execution);await denied(()=>resumeExternalWorkflow(db,owner,created.workflow.id,transport,execution),"google_rest_failed");now+=1000;await resumeExternalWorkflow(db,owner,created.workflow.id,transport,execution);
  ensure((await readExternalWorkflowView(db,owner,created.workflow.id)).state==="confirmed" && eventCreates===1,"일정 응답 유실 재조회·중복 방지 실패");
  const saved=await readGoogleSchedule(db,owner,"study");ensure(saved?.event.end.dateTime==="2026-10-26T00:20:00+09:00" && saved.event.recurrence[0].includes("UNTIL=20261107T145959Z"),"서울 시간·반복 규칙 보존 실패");
  const revised=await createGoogleSchedule(db,owner,"schedule-revised",{...schedule,version:2,durationMinutes:45},now);await resumeExternalWorkflow(db,owner,revised.workflow.id,transport,execution);await denied(()=>resumeExternalWorkflow(db,owner,revised.workflow.id,transport,execution),"google_rest_failed");now+=1000;await resumeExternalWorkflow(db,owner,revised.workflow.id,transport,execution);
  ensure((await readExternalWorkflowView(db,owner,revised.workflow.id)).state==="confirmed" && revised.event.eventId===created.event.eventId && eventCreates===1 && eventUpdates===1,"같은 반복 일정 갱신 실패");
  const review=await createGoogleSchedule(db,owner,"weekly-review",{...schedule,kind:"weekly-review"},now);ensure(review.event.eventId!==created.event.eventId && !JSON.stringify(review.event).includes("answer"),"주간 복습 구분·내용 최소화 실패");calendarMissing=true;const beforeEvents=eventCreates;await denied(()=>resumeExternalWorkflow(db,owner,review.workflow.id,transport,execution),"google_rest_failed");ensure(eventCreates===beforeEvents && (await readExternalWorkflowView(db,owner,review.workflow.id)).state!=="confirmed","삭제된 캘린더에서 일정 생성");
  calendarMissing=false;await resumeExternalWorkflow(db,owner,review.workflow.id,transport,execution);
  const responseRaces=await Promise.allSettled([resumeExternalWorkflow(db,owner,review.workflow.id,transport,execution),resumeExternalWorkflow(db,owner,review.workflow.id,transport,execution)]);
  for(const result of responseRaces)if(result.status==="rejected" && !(result.reason instanceof Error && "code" in result.reason && ["google_rest_failed","version_conflict"].includes(String(result.reason.code)))) throw result.reason;
  ensure(eventCreates===2,"동시 일정 실행이 중복 생성");events.delete(review.event.eventId);now+=1000;
  await denied(()=>resumeExternalWorkflow(db,owner,review.workflow.id,transport,execution),"google_rest_failed");ensure((await readExternalWorkflowView(db,owner,review.workflow.id)).state==="unknown" && eventCreates===2,"미발견 일정을 다시 생성");
  await denied(()=>createGoogleSchedule(db,owner,"review-new-request",{...schedule,kind:"weekly-review",version:2},now),"result_unknown");
  const beforeRevocation=requests;await db.prepare("UPDATE google_runtime SET state='reconsent' WHERE owner_id=?").bind(owner.userId).run();await denied(()=>resumeExternalWorkflow(db,owner,review.workflow.id,transport,execution),"reference_conflict");ensure(requests===beforeRevocation,"권한 상실 후 외부 호출");await db.prepare("UPDATE google_runtime SET state='active' WHERE owner_id=?").bind(owner.userId).run();
  const storedStudy=events.get(created.event.eventId);if(!storedStudy)throw new Error("수정 대상 일정 없음");events.set(created.event.eventId,{...storedStudy,summary:"사용자가 바꾼 일정"});
  const conflict=await createGoogleSchedule(db,owner,"schedule-third",{...schedule,version:3,durationMinutes:60},now);await resumeExternalWorkflow(db,owner,conflict.workflow.id,transport,execution);await denied(()=>resumeExternalWorkflow(db,owner,conflict.workflow.id,transport,execution),"external_content_conflict");ensure((await readExternalWorkflowView(db,owner,conflict.workflow.id)).state==="conflict" && eventUpdates===1 && events.get(created.event.eventId)?.summary==="사용자가 바꾼 일정","사용자 일정 편집 덮어쓰기");
  ensure((await db.prepare("SELECT count(*) AS n FROM google_requests WHERE owner_id=? AND sent_at IS NOT NULL").bind(owner.userId).first<{n:number}>())?.n===requests,"일정 요청 quota 누락");
  return ["calendar-dedicated-setup-concurrent-one-create-and-readback","calendar-seoul-midnight-weekday-until-and-minimal-data","calendar-existing-id-current-grant-and-primary-other-owner-denied","calendar-repeat-request-one-series-and-same-version-change-denied","calendar-event-response-loss-readback-no-reinsert","calendar-new-version-same-event-etag-update-readback","calendar-deleted-target-stops-before-event-create","calendar-all-rest-attempts-counted","calendar-concurrent-registration-and-execution-one-event","calendar-unknown-missing-event-never-recreated-or-version-bypassed","calendar-revoked-connection-stops-with-zero-calls","calendar-user-edited-event-conflict-with-zero-overwrite"];
}
