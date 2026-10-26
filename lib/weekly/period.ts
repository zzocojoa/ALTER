import { z } from "zod";
import { timestamp } from "../domain/contracts.ts";
import { addCalendarDays,calendarDate,seoulTimezone } from "../reviews/calendar.ts";

export const weeklyPeriod=z.object({start:calendarDate,endExclusive:calendarDate,startAt:timestamp,endAt:timestamp,timezone:seoulTimezone}).strict();
export type WeeklyPeriod=Readonly<z.infer<typeof weeklyPeriod>>;
/** 월요일 서울 자정을 포함하고 다음 월요일 서울 자정은 제외합니다. */
export function weekContaining(date:string):WeeklyPeriod {
  const day=calendarDate.parse(date);const calendar=new Date(`${day}T00:00:00Z`);
  calendar.setUTCDate(calendar.getUTCDate()-(calendar.getUTCDay()+6)%7);
  const start=calendarDate.parse(calendar.toISOString().slice(0,10));const endExclusive=addCalendarDays(start,7);
  return weeklyPeriod.parse({start,endExclusive,startAt:Date.parse(`${start}T00:00:00+09:00`),endAt:Date.parse(`${endExclusive}T00:00:00+09:00`),timezone:"Asia/Seoul"});
}
export function withinWeek(period:WeeklyPeriod,at:number):boolean {
  weeklyPeriod.parse(period);timestamp.parse(at);return at>=period.startAt && at<period.endAt;
}
