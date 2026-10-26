import { z } from "zod";
import { contentHash,studyDate,version,recordId } from "../domain/contracts.ts";
import { addCalendarDays,calendarDate } from "../reviews/calendar.ts";
import { externalExpected } from "../external/verification.ts";
import type { ExternalExpected } from "../external/verification.ts";
import type { ExternalWorkflowSeed,ExternalOperationSeed } from "../external/creation.ts";

const weekdays=["SU","MO","TU","WE","TH","FR","SA"] as const;
export const googleStudySchedule=z.object({kind:z.enum(["study","weekly-review"]),version,firstDate:studyDate,startTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),durationMinutes:z.number().int().min(5).max(240),weekdays:z.array(z.enum(weekdays)).min(1).max(7),repeatWeeks:z.number().int().min(1).max(52)}).strict().refine(value=>new Set(value.weekdays).size===value.weekdays.length,"반복 요일이 중복됐어요.").refine(value=>value.weekdays.includes(weekdays[new Date(`${value.firstDate}T00:00:00Z`).getUTCDay()]),"첫 학습일이 선택한 반복 요일과 일치해야 해요.");
export type GoogleStudySchedule=Readonly<z.infer<typeof googleStudySchedule>>;
export type GoogleCalendarEvent=Extract<ExternalExpected,{kind:"calendar-event"}>;
export type GoogleSchedulePredecessor=Readonly<{id:string;version:number;event:GoogleCalendarEvent}>;
export const googleStudyCalendarTitle:string="ALTER 학습 일정";
export async function googleCalendarTargetKey(subject:string):Promise<string> {z.string().min(1).max(200).parse(subject);return `calendar:setup:${await contentHash(subject)}`;}
export async function googleScheduleTargetKey(subject:string,kind:GoogleStudySchedule["kind"]):Promise<string> {return `calendar:${kind}:${await contentHash(subject)}`;}
function seoulDateTime(instant:number):string {return new Date(instant+9*60*60*1000).toISOString().slice(0,19)+"+09:00";}
/** 일정에는 학습 시간과 종류만 보내며 문제·답안·전체 대화는 받지 않습니다. */
export async function prepareGoogleStudyEvent(subject:string,value:GoogleStudySchedule):Promise<GoogleCalendarEvent> {
  const schedule=googleStudySchedule.parse(value);const businessKey=await googleScheduleTargetKey(subject,schedule.kind);
  const start=`${schedule.firstDate}T${schedule.startTime}:00+09:00`;const end=seoulDateTime(Date.parse(start)+schedule.durationMinutes*60_000);
  const lastDate=addCalendarDays(calendarDate.parse(schedule.firstDate),schedule.repeatWeeks*7-1);
  const until=new Date(`${lastDate}T23:59:59+09:00`).toISOString().replaceAll(/[-:]/g,"").replace(".000","");
  return externalExpected.options[4].parse({kind:"calendar-event",eventId:`alter${await contentHash(businessKey)}`,businessKey,summary:schedule.kind==="study"?"ALTER 학습 시간":"ALTER 주간 복습",description:schedule.kind==="study"?"ALTER에서 정한 학습 시간입니다.":"ALTER에서 정한 주간 복습 시간입니다.",start:{dateTime:start,timeZone:"Asia/Seoul"},end:{dateTime:end,timeZone:"Asia/Seoul"},recurrence:[`RRULE:FREQ=WEEKLY;BYDAY=${weekdays.filter(day=>schedule.weekdays.includes(day)).join(",")};UNTIL=${until}`]});
}
export async function prepareGoogleCalendarSetup(subject:string):Promise<ExternalWorkflowSeed> {
  const targetKey=await googleCalendarTargetKey(subject);
  return {jobId:null,kind:"calendar",targetKey,sourceVersion:"1",predecessorId:null,operations:[{stepKind:"calendar",kind:"calendar-create",businessKey:targetKey,externalId:null,requestSnapshot:JSON.stringify({kind:"calendar-create",title:googleStudyCalendarTitle}),expectedSnapshot:JSON.stringify({kind:"calendar",title:googleStudyCalendarTitle,timeZone:"Asia/Seoul"})}]};
}
export async function prepareGoogleSchedule(subject:string,calendarId:string,value:GoogleStudySchedule,previous:GoogleSchedulePredecessor|null):Promise<ExternalWorkflowSeed> {
  const schedule=googleStudySchedule.parse(value);z.string().min(1).refine(id=>id!=="primary").parse(calendarId);
  if(previous===null?schedule.version!==1:schedule.version!==previous.version+1) throw new TypeError("일정 버전이 달라요. 현재 일정을 다시 확인해 주세요.");
  const event=await prepareGoogleStudyEvent(subject,schedule);const target={source:"known",externalId:calendarId};
  if(previous!==null && (previous.event.eventId!==event.eventId || previous.event.businessKey!==event.businessKey)) throw new TypeError("이전 일정과 현재 업무 키가 달라요.");
  const kind=previous===null?"calendar-event-create":"calendar-event-update";
  const operations:readonly ExternalOperationSeed[]=[{stepKind:"calendar",kind:"calendar-verify",businessKey:`${event.businessKey}:calendar`,externalId:calendarId,requestSnapshot:JSON.stringify({kind:"calendar-verify",target}),expectedSnapshot:JSON.stringify({kind:"calendar",title:googleStudyCalendarTitle,timeZone:"Asia/Seoul"})},{stepKind:"calendar",kind,businessKey:event.businessKey,externalId:calendarId,requestSnapshot:JSON.stringify({kind,target,...(previous===null?{}:{base:previous.event})}),expectedSnapshot:JSON.stringify(event)}];
  return {jobId:null,kind:"calendar",targetKey:event.businessKey,sourceVersion:String(schedule.version),predecessorId:previous===null?null:recordId.parse(previous.id),operations:[...operations]};
}
