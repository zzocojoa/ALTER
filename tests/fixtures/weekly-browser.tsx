import { createRoot } from "react-dom/client";
import { WeeklyClient } from "../../app/learn/weekly/weekly-client";
import { weeklyView } from "../../lib/weekly/view";
import "../../app/learn/weekly/weekly.css";
const element=document.getElementById("weekly-fixture");const data=document.getElementById("weekly-initial");if(!element || !data) throw new Error("주간 화면 검사 입력이 없습니다.");
const initial=weeklyView.parse(JSON.parse(data.textContent ?? ""));const state=initial.state;
createRoot(element).render(<WeeklyClient initial={initial} overview={{today:state.date,courses:[{id:state.courseId,title:"시험 분수 과정"}],history:[{id:state.id,courseId:state.courseId,start:state.context.aggregate.period.start,end:state.context.aggregate.period.endExclusive,version:state.version}]}}/>);
