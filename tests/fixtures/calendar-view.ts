import { recordId } from "../../lib/domain/contracts";
import type { ExternalWorkflowState } from "../../lib/external/state";
import type { GoogleCalendarView } from "../../lib/google-calendar/view";
import type { ExternalWorkflowView } from "../../lib/external/resume";

export function calendarViewFixture(state: ExternalWorkflowState, target: "setup" | "schedule"): GoogleCalendarView {
  const workflow: ExternalWorkflowView = { id: recordId.parse("00000000-0000-4000-8000-000000001601"), version: 3, kind: "calendar", state, targetKey: "fixture", sourceVersion: "2", deadlineAt: 1793000000000, operations: [{ id: "00000000-0000-4000-8000-000000001602", kind: "calendar", ordinal: 1, state: state === "partial" ? "confirmed" : state, attemptCount: 1, nextAttemptAt: 0, externalId: null, lastFailure: null }] };
  const event = { kind: "calendar-event" as const, eventId: "fixture-event", businessKey: "fixture", summary: "ALTER 주간 복습", description: "시험 일정", start: { dateTime: "2026-10-27T20:00:00+09:00", timeZone: "Asia/Seoul" as const }, end: { dateTime: "2026-10-27T21:00:00+09:00", timeZone: "Asia/Seoul" as const }, recurrence: ["RRULE:FREQ=WEEKLY;BYDAY=TU;COUNT=2"] };
  return target === "setup" ? { setup: { workflow, calendarId: null }, study: null, review: null } : { setup: { workflow: null, calendarId: "fixture-calendar" }, study: { workflow, event }, review: null };
}
