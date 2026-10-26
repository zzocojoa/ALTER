import { calculateResult } from "../../lib/results/evidence";
import { tutorState } from "../../lib/tutor/contracts";
import { weekContaining } from "../../lib/weekly/period";
import type { WeeklyCollection } from "../../lib/weekly/evidence";
import { resultFixture } from "./result-state";
import { tutorId } from "./tutor-state";

/** 기존 수행 판정 픽스처를 확정 사건과 실제 답안 계약에 연결합니다. */
export function weeklyEvidenceFixture():WeeklyCollection {
  const result=resultFixture();const period=weekContaining("2026-10-25");const original=result.states[0];
  const state=tutorState.parse({...original,answers:original.answers.map((answer,index)=>({...answer,submittedAt:period.startAt+index+1})),phase:"finished",version:original.version+1});
  const judgment=calculateResult({...result,states:[state]});
  return {period,courseId:state.start.bundle.unit.courseId,sessions:[{sessionId:state.id,resultVersionId:tutorId(1310),resultOrdinal:2,sessionVersion:original.version,confirmedAt:period.startAt+100,state,judgment}],answers:state.answers.map(answer=>{const fact=result.facts.find(item=>item.id===answer.id);if(!fact) throw new Error("주간 픽스처 실제 답안 누락");return {id:answer.id,sessionId:state.id,questionId:answer.questionId,attemptId:answer.attemptId,version:fact.version,text:answer.text,submittedAt:answer.submittedAt,hidden:fact.hidden,mode:fact.mode,status:fact.status,helpIds:[]};}),reviews:[],corrections:[]};
}
