import { z } from "zod";
import { studyDate,domainFailure } from "../domain/contracts.ts";

export const seoulTimezone=z.literal("Asia/Seoul");
export type SeoulTimezone=z.infer<typeof seoulTimezone>;
export const calendarDate=studyDate.brand<"SeoulCalendarDate">();
export type CalendarDate=z.infer<typeof calendarDate>;
export const instant=z.string().datetime({offset:true}).refine((value)=>Number.isFinite(Date.parse(value))).brand<"ReviewInstant">();
export type Instant=z.infer<typeof instant>;
/** 서버 시간대와 시계를 읽지 않고 명시된 시각을 서울 달력 날짜로 변환합니다. */
export function seoulCalendarDate(value:Instant,timezone:SeoulTimezone):CalendarDate {
  instant.parse(value);seoulTimezone.parse(timezone);
  return calendarDate.parse(new Intl.DateTimeFormat("sv-SE",{timeZone:timezone,year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(value)));
}
/** UTC는 달력 필드 연산에만 사용하고 경과 밀리초를 하루로 간주하지 않습니다. */
export function addCalendarDays(value:CalendarDate,days:number):CalendarDate {
  calendarDate.parse(value);z.number().int().min(0).max(3650).parse(days);
  const date=new Date(`${value}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()+days);
  const result=date.toISOString().slice(0,10);if(result.length!==10) throw domainFailure("validation","review.calendar-range",null);
  return calendarDate.parse(result);
}
export function daysUntil(start:CalendarDate,end:CalendarDate):number {
  calendarDate.parse(start);calendarDate.parse(end);
  return (Date.parse(`${end}T00:00:00Z`)-Date.parse(`${start}T00:00:00Z`))/86_400_000;
}
