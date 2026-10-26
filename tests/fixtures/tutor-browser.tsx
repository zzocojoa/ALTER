import { createRoot } from "react-dom/client";
import { TutorClient } from "../../app/learn/tutor/tutor-client";
import { tutorOverview } from "../../lib/tutor/overview";
import { tutorView } from "../../lib/tutor/view";
import "../../app/learn/tutor/tutor.css";
const element=document.getElementById("tutor-fixture");const data=document.getElementById("tutor-initial");
if(!element || !data) throw new Error("화면 검사 입력이 없습니다.");
const parsed=JSON.parse(data.textContent ?? "");
createRoot(element).render(<TutorClient initial={tutorOverview.parse(parsed.overview)} initialView={parsed.view===null ? null : tutorView.parse(parsed.view)}/>);
