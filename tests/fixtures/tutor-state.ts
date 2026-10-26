import { recordId } from "../../lib/domain/contracts";
import { ASSESSMENT_CONTRACT } from "../../lib/advisor/contracts";
import { tutorStartContext } from "../../lib/tutor/start";
import type { TutorStartContext } from "../../lib/tutor/start";
import { initialTutor } from "../../lib/tutor/state";
import type { TutorState, TutorLesson, TutorAnswer, TutorDiagnosis } from "../../lib/tutor/contracts";

export function tutorId(n: number): ReturnType<typeof recordId.parse> { return recordId.parse(`00000000-0000-4000-a000-${String(n).padStart(12,"0")}`); }
export function tutorStartFixture(): TutorStartContext {
  const evidence: string = "분수는 전체를 같은 크기로 나눈 부분을 나타냅니다. 1/4은 같은 크기 네 조각 중 한 조각입니다.";
  return tutorStartContext.parse({ scopeId:tutorId(1),scopeVersion:4,today:"2026-10-24",latest:null,reviews:[],due:[],issues:[],bundle:{
    unit:{planId:tutorId(2),planVersionId:tutorId(3),planOrdinal:1,courseId:tutorId(4),unitId:tutorId(5),unitVersion:1,title:"분수",objective:"분수의 뜻 설명",selfExplanationCriterion:"자료 없이 설명",newConditionCriterion:"새 조건 독립 수행",prerequisiteUnitIds:[],assessment:ASSESSMENT_CONTRACT,selfReportedLevel:"입문"},
    date:"2026-10-24",availableMinutes:30,plannedMinutes:20,selectedLinkIds:[tutorId(6)],sources:[{id:tutorId(7),materialId:tutorId(8),uploadId:tutorId(9),pageId:tutorId(10),filePage:1,printedPage:null,spanStart:0,spanEnd:Array.from(evidence).length,evidence}],question:{text:"분수는 무엇인가요?",sourceRefIds:[tutorId(7)]},exercise:{text:"1/4을 설명하세요.",sourceRefIds:[tutorId(7)]},assessment:ASSESSMENT_CONTRACT
  }});
}
export function tutorStateFixture(): TutorState { return initialTutor(tutorId(11),tutorStartFixture(),tutorId(12),tutorId(13)); }
export function tutorLessonFixture(): TutorLesson { return {kind:"tutor-lesson",explanation:{text:"똑같이 나눈 부분을 생각해 보세요.",citations:[{sourceRefId:tutorId(7),quote:"분수는 전체를 같은 크기로 나눈 부분을 나타냅니다."}]}}; }
export function tutorAnswerFixture(): TutorAnswer { return {id:tutorId(14),questionId:tutorId(12),attemptId:tutorId(13),text:"전체를 같은 크기로 나눈 부분입니다.",fileIds:[],submittedAt:1,helped:false}; }
export function tutorDiagnosisFixture(): TutorDiagnosis { return {kind:"tutor-diagnosis",questionId:tutorId(12),answerId:tutorId(14),readability:"readable",correct:true,observation:"같은 크기라는 조건을 설명했어요.",citations:tutorLessonFixture().explanation.citations,needsHelp:false}; }
