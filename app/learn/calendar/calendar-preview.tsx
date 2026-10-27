import type { ReactElement } from "react";
import { addCalendarDays, calendarDate } from "@/lib/reviews/calendar";
import { googleStudyCalendarTitle } from "@/lib/google-calendar/contract";
import type { GoogleStudySchedule } from "@/lib/google-calendar/contract";

const dayNames: Readonly<Record<GoogleStudySchedule["weekdays"][number], string>> = { SU: "일", MO: "월", TU: "화", WE: "수", TH: "목", FR: "금", SA: "토" };
export type CalendarPreview = Readonly<{ schedule: GoogleStudySchedule; requestKey: string }>;
export function CalendarPreviewDetails({ preview, busy, onSend }: Readonly<{ preview: CalendarPreview; busy: boolean; onSend: () => void }>): ReactElement {
  const schedule = preview.schedule;
  return <section className="calendar-preview" aria-label="Google 일정 전송 전 확인"><h3>Google 일정 전송 전 확인</h3>
    <dl><div><dt>저장 대상</dt><dd>{googleStudyCalendarTitle} · ALTER 전용 캘린더</dd></div><div><dt>일정</dt><dd>{schedule.kind === "study" ? "ALTER 학습 시간" : "ALTER 주간 복습"} · {schedule.version}판</dd></div><div><dt>첫 시작</dt><dd>{schedule.firstDate} {schedule.startTime} · 한국 시간 (Asia/Seoul)</dd></div><div><dt>길이와 반복</dt><dd>매회 {schedule.durationMinutes}분 · 매주 {schedule.weekdays.map(day => dayNames[day]).join("·")}요일 · {schedule.repeatWeeks}주</dd></div><div><dt>반복 기간 종료</dt><dd>{addCalendarDays(calendarDate.parse(schedule.firstDate), schedule.repeatWeeks * 7 - 1)}</dd></div></dl>
    <p>아직 Google에 전송하지 않았어요. 일정 종류와 시간만 보내며, 문제·답안·대화는 보내지 않아요. 입력을 바꾸면 다시 확인해 주세요.</p>
    <button className="storage-check-button" type="button" disabled={busy} onClick={onSend}>확인한 일정 Google에 전송</button>
  </section>;
}
