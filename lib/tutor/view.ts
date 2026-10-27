import { tutorExposureCounts } from "./exposure.ts";
import { TUTOR_DIRECTION_TEXT,TUTOR_DIRECTION_PROMPT } from "./direction.ts";
import { currentTutorHelp } from "./help.ts";
import { z } from "zod";
import { tutorAnswer, tutorDiagnosis, tutorExplanation, tutorHelpRecord, tutorQuestion, tutorState } from "./contracts.ts";
import type { TutorState } from "./contracts.ts";
import { sourceExcerpt } from "../librarian/contracts.ts";

/** 진단 인용에는 정답이 포함될 수 있어 평가 근거는 저장하고 진행 화면에는 보내지 않습니다. */
const visibleDiagnosis=tutorDiagnosis.extend({citations:tutorDiagnosis.shape.citations.max(0).min(0)});
const visibleHelp=tutorHelpRecord.extend({explanation:tutorExplanation.extend({citations:tutorExplanation.shape.citations.min(0)})});
const helpHistoryItem = tutorHelpRecord.pick({ id:true, questionId:true, answerId:true, stage:true, committedAt:true });
export const tutorView = z.object({ originalExposure:tutorExposureCounts.nullable(),helpHistory:z.array(helpHistoryItem).max(200), review:tutorState.shape.review,draft:tutorState.shape.draft,id:tutorState.shape.id,version:tutorState.shape.version,title:z.string(),courseId:tutorState.shape.id,phase:tutorState.shape.phase,resumePhase:tutorState.shape.resumePhase,question:tutorQuestion,lesson:tutorExplanation.nullable(),sources:z.array(sourceExcerpt),answers:z.array(tutorAnswer),diagnosis:visibleDiagnosis.nullable(),help:visibleHelp.nullable(),pending:tutorState.shape.pending,hidden:z.boolean(),nextAction:z.string().nullable(),dueCount:z.number().int().nonnegative(),startIssues:tutorState.shape.start.shape.issues,current:z.boolean(),issue:z.string().nullable() }).strict();
export type TutorView = Readonly<z.infer<typeof tutorView>>;
/** 인출·일시정지 화면에는 과거 설명과 원문을 직렬화하지 않습니다. */
export function publicTutorView(state: TutorState): TutorView {
  const phase=state.phase==="paused" ? state.resumePhase : state.phase;
  const hidden:boolean=phase!=="explanation" && phase!=="finished";
  const help=state.phase==="paused" ? null : currentTutorHelp(state);
  const displayedHelp=help && (help.stage==="direction" || help.stage==="small-question") ? {...help,explanation:{...help.explanation,citations:[]}} : help;
  const unsafeDirection=help?.stage==="direction" && (help.explanation.text!==TUTOR_DIRECTION_TEXT || help.learnerPrompt!==TUTOR_DIRECTION_PROMPT);
  const checkedHelp=unsafeDirection && displayedHelp ? {...displayedHelp,explanation:{...displayedHelp.explanation,text:"이전 도움에 정답 설명이 포함되어 본문을 다시 표시하지 않아요. 원래 내용과 도움 사용 이력은 보존돼요."},learnerPrompt:TUTOR_DIRECTION_PROMPT} : displayedHelp;
  return tutorView.parse({originalExposure:null,helpHistory:state.help.map((entry)=>({id:entry.id,questionId:entry.questionId,answerId:entry.answerId,stage:entry.stage,committedAt:entry.committedAt})),...(state.review ? {review:state.review} : {}),draft:state.draft,id:state.id,version:state.version,title:state.start.bundle.unit.title,courseId:state.start.bundle.unit.courseId,phase:state.phase,resumePhase:state.resumePhase,question:state.question,lesson:hidden || state.phase==="paused" ? null : state.lesson,sources:hidden || state.phase==="paused" ? [] : state.start.bundle.sources,answers:state.phase==="paused" || phase==="awaiting-answer" ? [] : state.answers.filter((answer):boolean=>answer.questionId===state.question.id),diagnosis:state.phase==="diagnosed" && state.diagnosis ? {...state.diagnosis,citations:[]} : null,help:checkedHelp,pending:state.pending,hidden,nextAction:hidden ? null : state.start.latest?.nextAction ?? null,dueCount:state.start.due.length,startIssues:state.start.issues,current:true,issue:null});
}
