import { z } from "zod";
import { domainFailure,canonicalJson,recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { requireGoogleMethodScope } from "../../lib/google/permissions.ts";
import { googleCalendarTargetKey,googleScheduleTargetKey,googleStudySchedule,prepareGoogleCalendarSetup,prepareGoogleSchedule,prepareGoogleStudyEvent,googleStudyCalendarTitle } from "../../lib/google-calendar/contract.ts";
import type { GoogleStudySchedule,GoogleSchedulePredecessor,GoogleCalendarEvent } from "../../lib/google-calendar/contract.ts";
import { externalExpected } from "../../lib/external/verification.ts";
import { readManagedGoogleConnection } from "./google-managed.ts";
import type { ManagedGoogleConnection } from "./google-managed.ts";
import { readGoogleResource } from "./google-resources.ts";
import { readStorage } from "./atomic.ts";
import { createExternalWorkflow } from "./external-workflow.ts";
import { readExternalWorkflowView } from "../../lib/external/resume.ts";
import type { ExternalWorkflowView } from "../../lib/external/resume.ts";

async function calendarConnection(db:D1Database,owner:SiteIdentity):Promise<ManagedGoogleConnection> {
  const connection=await readManagedGoogleConnection(db,owner);if(connection===null || !["active","partial"].includes(connection.state)) throw domainFailure("reference_conflict","google-calendar.connection-required",null);
  requireGoogleMethodScope("calendar.calendars.insert",connection.scopes);return connection;
}
export type GoogleCalendarSetupView=Readonly<{workflow:ExternalWorkflowView|null;calendarId:string|null}>;
/** 이 계정의 전용 생성 작업에서 확인된 캘린더만 사용합니다. */
export async function readGoogleCalendarSetup(db:D1Database,owner:SiteIdentity):Promise<GoogleCalendarSetupView> {
  const connection=await calendarConnection(db,owner);const key=await googleCalendarTargetKey(connection.googleSubject);
  const row=await readStorage("google-calendar.setup",()=>db.prepare("SELECT id FROM external_workflows WHERE owner_id=? AND kind='calendar' AND target_key=? AND source_version='1' AND google_subject=?").bind(owner.userId,key,connection.googleSubject).first<{id:string}>());
  if(!row) return {workflow:null,calendarId:null};const workflow=await readExternalWorkflowView(db,owner,row.id);if(workflow.state!=="confirmed") return {workflow,calendarId:null};
  const targets=await readStorage("google-calendar.setup-proof",()=>db.prepare("SELECT external_id AS id,snapshot FROM external_operations WHERE owner_id=? AND workflow_id=? AND kind='calendar-create' AND state='confirmed'").bind(owner.userId,row.id).all<{id:string;snapshot:string}>());
  if(targets.results.length!==1) throw domainFailure("reference_conflict","google-calendar.setup-proof",null);
  const expected=externalExpected.parse(z.object({expected:z.unknown()}).parse(JSON.parse(targets.results[0].snapshot)).expected);
  if(expected.kind!=="calendar" || expected.title!==googleStudyCalendarTitle || expected.timeZone!=="Asia/Seoul") throw domainFailure("reference_conflict","google-calendar.setup-content",null);
  const calendarId=targets.results[0].id;await readGoogleResource(db,owner,connection,calendarId,"calendar-target");return {workflow,calendarId};
}
export async function createGoogleCalendarSetup(db:D1Database,owner:SiteIdentity,requestKey:string,now:number):Promise<GoogleCalendarSetupView> {
  const connection=await calendarConnection(db,owner);await createExternalWorkflow(db,owner,requestKey,await prepareGoogleCalendarSetup(connection.googleSubject),now);return readGoogleCalendarSetup(db,owner);
}
export type GoogleScheduleView=Readonly<{workflow:ExternalWorkflowView;event:GoogleCalendarEvent}>;
export async function readGoogleSchedule(db:D1Database,owner:SiteIdentity,kind:GoogleStudySchedule["kind"]):Promise<GoogleScheduleView|null> {
  const connection=await calendarConnection(db,owner);const targetKey=await googleScheduleTargetKey(connection.googleSubject,kind);
  const rows=await readStorage("google-calendar.schedule-latest",()=>db.prepare("SELECT w.id FROM external_workflows w WHERE w.owner_id=? AND w.kind='calendar' AND w.target_key=? AND w.google_subject=? AND NOT EXISTS(SELECT 1 FROM external_workflows n WHERE n.owner_id=w.owner_id AND json_extract(n.snapshot,'$.predecessorId')=w.id) LIMIT 2").bind(owner.userId,targetKey,connection.googleSubject).all<{id:string}>());
  if(rows.results.length===0) return null;if(rows.results.length!==1) throw domainFailure("reference_conflict","google-calendar.schedule-ambiguous",null);
  const workflow=await readExternalWorkflowView(db,owner,rows.results[0].id);
  const events=await readStorage("google-calendar.schedule-content",()=>db.prepare("SELECT snapshot FROM external_operations WHERE owner_id=? AND workflow_id=? AND kind IN ('calendar-event-create','calendar-event-update')").bind(owner.userId,workflow.id).all<{snapshot:string}>());
  if(events.results.length!==1) throw domainFailure("reference_conflict","google-calendar.event-proof",null);
  const event=externalExpected.options[4].parse(z.object({expected:z.unknown()}).parse(JSON.parse(events.results[0].snapshot)).expected);
  return {workflow,event};
}
export async function createGoogleSchedule(db:D1Database,owner:SiteIdentity,requestKey:string,value:GoogleStudySchedule,now:number):Promise<GoogleScheduleView> {
  const schedule=googleStudySchedule.parse(value);const connection=await calendarConnection(db,owner);const setup=await readGoogleCalendarSetup(db,owner);
  if(!setup.calendarId) throw domainFailure("result_unknown","google-calendar.finish-setup",{id:setup.workflow?.id??null});
  const current=await readGoogleSchedule(db,owner,schedule.kind);const expected=await prepareGoogleStudyEvent(connection.googleSubject,schedule);
  if(current && current.workflow.sourceVersion===String(schedule.version)) {if(canonicalJson(expected)!==canonicalJson(current.event)) throw domainFailure("version_conflict","google-calendar.same-version-changed",null);return current;}
  if(current && current.workflow.state!=="confirmed") throw domainFailure("result_unknown","google-calendar.previous-unconfirmed",{id:current.workflow.id});
  const previous:GoogleSchedulePredecessor|null=current===null?null:{id:current.workflow.id,version:z.coerce.number().int().positive().parse(current.workflow.sourceVersion),event:current.event};
  const seed=await prepareGoogleSchedule(connection.googleSubject,setup.calendarId,schedule,previous);
  await createExternalWorkflow(db,owner,requestKey,seed,now);const saved=await readGoogleSchedule(db,owner,schedule.kind);if(!saved) throw domainFailure("result_unknown","google-calendar.save-not-observed",null);recordId.parse(saved.workflow.id);return saved;
}
