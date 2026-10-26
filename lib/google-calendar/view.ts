import type { GoogleCalendarSetupView,GoogleScheduleView } from "../../db/repositories/google-calendar.ts";
export type GoogleCalendarView=Readonly<{setup:GoogleCalendarSetupView;study:GoogleScheduleView|null;review:GoogleScheduleView|null}>;
