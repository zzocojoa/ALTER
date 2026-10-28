import { PageHeader } from "@/components/alter/page-header";
import { env } from "cloudflare:workers";
import type { ReactElement } from "react";
import { forbidden,unauthorized } from "next/navigation";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { readGoogleConnectionView } from "@/lib/google/server";
import { googleConnectionCanUseData } from "@/lib/google/view";
import { readGoogleCalendarSetup,readGoogleSchedule } from "@/db/repositories/google-calendar";
import { GoogleCalendarClient } from "./calendar-client";
import "./calendar.css";
export const dynamic="force-dynamic";
export default async function CalendarPage():Promise<ReactElement> {
  const access=await materialOwnerAccess();if(access.rejection){if(access.rejection.status===401)unauthorized();forbidden();}
  const connection=await readGoogleConnectionView(access.owner);const usable=googleConnectionCanUseData(connection.connection) && connection.connection?.calendarAllowed;
  const initial=usable?{setup:await readGoogleCalendarSetup(env.DB,access.owner),study:await readGoogleSchedule(env.DB,access.owner,"study"),review:await readGoogleSchedule(env.DB,access.owner,"weekly-review")}:null;
  return <main id="learn-main" tabIndex={-1} className="site-shell"><PageHeader title="학습 일정" context="학습 · 일정" back={{ href: "/learn/tutor#reviews", label: "복습으로" }} action={null} /><p>반복 학습과 주간 복습 시간을 정하면 ALTER 전용 Google 캘린더에 기록해요.</p>{initial?<GoogleCalendarClient initial={initial}/>:<p><a href="/learn/google">Google 연결과 캘린더 권한을 먼저 확인해 주세요.</a></p>}</main>;
}
