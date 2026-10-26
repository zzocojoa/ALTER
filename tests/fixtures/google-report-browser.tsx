import { createRoot } from "react-dom/client";
import { GoogleCalendarClient } from "../../app/learn/calendar/calendar-client";
import { GoogleReferencesClient } from "../../app/learn/google/references/references-client";
import "../../app/globals.css";
import "../../app/learn/calendar/calendar.css";
const root=document.getElementById("google-fixture");if(!root)throw new Error("Google 화면 검사 요소가 없습니다.");
createRoot(root).render(<main className="site-shell"><GoogleCalendarClient initial={{setup:{workflow:null,calendarId:"fixture-calendar@group.calendar.google.com"},study:null,review:null}}/><GoogleReferencesClient files={[{id:"fixture-reference",name:"선택한 시험 문서",mimeType:"application/vnd.google-apps.document"}]} courses={[{id:"00000000-0000-4000-8000-000000001600",title:"시험 학습 공간"}]}/></main>);
