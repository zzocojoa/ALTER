import { describe,it,expect } from "vitest";
import { googleStudySchedule,prepareGoogleStudyEvent,prepareGoogleSchedule } from "../../lib/google-calendar/contract";

const schedule=googleStudySchedule.parse({kind:"study",version:1,firstDate:"2026-10-25",startTime:"23:50",durationMinutes:30,weekdays:["SU","WE"],repeatWeeks:2});
describe("서울 반복 학습 일정",()=>{
  it("자정을 넘는 종료 시각과 마지막 반복 주를 서울 날짜로 계산한다",async()=>{const event=await prepareGoogleStudyEvent("subject",schedule);expect(event.start).toEqual({dateTime:"2026-10-25T23:50:00+09:00",timeZone:"Asia/Seoul"});expect(event.end.dateTime).toBe("2026-10-26T00:20:00+09:00");expect(event.recurrence).toEqual(["RRULE:FREQ=WEEKLY;BYDAY=SU,WE;UNTIL=20261107T145959Z"]);});
  it("학습·복습 업무 키와 이벤트 ID는 버전이 바뀌어도 유지되고 계정·종류별로 구분된다",async()=>{const first=await prepareGoogleStudyEvent("subject",schedule);const revised=await prepareGoogleStudyEvent("subject",{...schedule,version:2});expect(revised.eventId).toBe(first.eventId);expect(revised.businessKey).toBe(first.businessKey);expect((await prepareGoogleStudyEvent("other",schedule)).eventId).not.toBe(first.eventId);expect((await prepareGoogleStudyEvent("subject",{...schedule,kind:"weekly-review"})).eventId).not.toBe(first.eventId);expect(first.eventId).toMatch(/^[a-v0-9]+$/);});
  it("첫 날짜·요일·기간·시각 오류와 학습 원문 입력을 거부한다",()=>{for(const change of [{firstDate:"2026-02-30"},{weekdays:["MO"]},{weekdays:["SU","SU"]},{startTime:"24:00"},{durationMinutes:0},{repeatWeeks:53},{answer:"개인 답안"}]) expect(()=>googleStudySchedule.parse({...schedule,...change})).toThrow();});
  it("기본 캘린더와 이전 버전을 건너뛰는 갱신을 거부한다",async()=>{await expect(prepareGoogleSchedule("subject","primary",schedule,null)).rejects.toThrow();await expect(prepareGoogleSchedule("subject","alter-calendar",{...schedule,version:2},null)).rejects.toThrow();});
});
