import { editorIssueLabels } from "../editor/presentation.ts";
import { z } from "zod";
import { recordId,version,seoulStudyDate } from "../domain/contracts.ts";
import type { Performance } from "../domain/contracts.ts";
import { normalizedPerformanceText,repeatsPreviousAnswer } from "../tutor/identity.ts";
import type { TutorAnswer,TutorState } from "../tutor/contracts.ts";
import type { ResultEvidence,ResultJudgment } from "./contracts.ts";

export const answerFact=z.object({id:recordId,sessionId:recordId,questionId:recordId,attemptId:recordId,version,attemptVersion:version,text:z.string(),mode:z.string(),hidden:z.number().int(),status:z.string(),answerEventVersion:version.nullable(),exposureVersion:version.nullable(),diagnosisVersion:version.nullable(),helpIds:z.string(),variation:z.string().nullable()}).strict();
export type AnswerFact=Readonly<z.infer<typeof answerFact>>;
export type DelayedEvidence=Readonly<{answerId:string;correct:boolean;hidden:boolean;helped:boolean;performedAt:number;independentAt:number}>;
export type JudgmentInput=Readonly<{states:readonly TutorState[];facts:readonly AnswerFact[];planVersionId:string;unitVersion:number;correctionRequired:boolean;invalidSourceIds:readonly string[];correctionCutoff?:number|null;delayed:readonly DelayedEvidence[]}>;

function answerReasons(input:JudgmentInput,state:TutorState,answer:TutorAnswer,fact:AnswerFact|undefined):readonly string[] {
  const question=state.questions.find((item)=>item.id===answer.questionId);
  const diagnosis=state.diagnoses.findLast((item)=>item.answerId===answer.id && item.questionId===answer.questionId);
  const reasons:string[]=[];
  if(input.correctionCutoff!==undefined && input.correctionCutoff!==null && answer.submittedAt<=input.correctionCutoff) reasons.push("정정 이전 답안은 새 수행 증거로 사용할 수 없어요.");
  if(!fact || fact.attemptId!==answer.attemptId || fact.questionId!==answer.questionId || fact.text!==(answer.text.length ? answer.text : "[사진 답안]") || !fact.answerEventVersion) reasons.push("DB 답안과 불변 저장 사건을 확인할 수 없어요.");
  if(!diagnosis || !fact?.diagnosisVersion) reasons.push("저장된 평가가 아직 없어요.");
  else if(diagnosis.readability!=="readable" || diagnosis.correct!==true || diagnosis.needsHelp) reasons.push("답안이 평가 기준을 충족했다고 확인되지 않았어요.");
  if(!fact || fact.hidden!==1 || !fact.exposureVersion || !fact.answerEventVersion || fact.exposureVersion>=fact.answerEventVersion) reasons.push("답안을 쓰기 전에 자료가 가려졌다는 저장 기록이 없어요.");
  if(answer.helped || !fact || JSON.parse(fact.helpIds).length>0 || state.help.some((help)=>help.questionId===answer.questionId)) reasons.push("이 문제에서 제공된 도움 이력이 있어요.");
  if(fact?.status!=="ready") reasons.push("제출이 완료된 답안이 아니에요.");
  if(state.start.bundle.unit.planVersionId!==input.planVersionId || state.start.bundle.unit.unitVersion!==input.unitVersion || input.correctionRequired) reasons.push("현재 기준이나 정정 내용을 반영한 재확인이 필요해요.");
  if(state.start.bundle.sources.some((source)=>input.invalidSourceIds.includes(source.id))) reasons.push("이 답안의 출처가 교체되거나 정정되어 현재 근거로 사용할 수 없어요.");
  if(!answer.contentFingerprint) reasons.push("답안 내용 지문을 확인할 수 없어요.");
  const earlier=input.states.flatMap((item)=>item.answers).filter((item)=>item.id!==answer.id && item.submittedAt<=answer.submittedAt);
  if(earlier.some((item)=>item.questionId===answer.questionId)) reasons.push("이미 제출한 동일 문제의 재시도는 첫 독립 수행 근거로 세지 않아요.");
  if(repeatsPreviousAnswer(answer,earlier)) reasons.push("이전 답안과 같은 내용을 다시 제출했어요.");
  if(question?.mode==="new-condition") {
    const relation=state.variations.find((item)=>item.questionId===question.id);
    const parent=state.questions.find((item)=>item.id===relation?.parentQuestionId);
    if(!relation || !parent || !fact?.variation || JSON.stringify(JSON.parse(fact.variation))!==JSON.stringify(relation) || normalizedPerformanceText(relation.change.before)===normalizedPerformanceText(relation.change.after) || normalizedPerformanceText(parent.prompt)===normalizedPerformanceText(question.prompt) || !question.originalQuestionId || fact.mode!=="new-condition") reasons.push("실제 조건 변경과 원문제 연결을 확인할 수 없어요.");
    const earlierQuestions=input.states.flatMap((item)=>item.questions).filter((item)=>item.id!==question.id && earlier.some((old)=>old.questionId===item.id));
    if(earlierQuestions.some((old)=>normalizedPerformanceText(old.prompt)===normalizedPerformanceText(question.prompt))) reasons.push("문제 ID만 달라진 같은 질문이에요.");
  }
  return reasons;
}
export function collectResultEvidence(input:JudgmentInput):readonly ResultEvidence[] {
  return input.states.flatMap((state)=>state.answers.flatMap((answer):ResultEvidence[]=>{
    const question=state.questions.find((item)=>item.id===answer.questionId);if(!question || question.mode==="practice") return [];
    const fact=input.facts.find((item)=>item.id===answer.id && item.sessionId===state.id);
    const reasons=answerReasons(input,state,answer,fact);const diagnosis=state.diagnoses.findLast((item)=>item.answerId===answer.id);
    return [{sessionId:state.id,sessionVersion:state.version,answerId:answer.id,answerVersion:fact?.version ?? null,questionId:question.id,kind:question.mode,accepted:reasons.length===0,reasons:[...reasons],observation:diagnosis?.observation ?? "저장된 평가 없음",helpIds:fact ? z.array(recordId).parse(JSON.parse(fact.helpIds)) : []}];
  }));
}
/** 일정과 시간 경과만으로 승격하지 않고 서로 다른 학습일의 실제 독립 답안을 요구합니다. */
export function hasDelayedRecall(evidence:readonly DelayedEvidence[]):boolean {
  return evidence.some((item)=>item.correct && item.hidden && !item.helped && item.answerId.length>0 && seoulStudyDate(item.performedAt)>seoulStudyDate(item.independentAt));
}
/** 원본 기록을 변경하지 않고 두 수행 기준과 지연 재현을 각각 계산합니다. */
export function calculateResult(input:JudgmentInput):ResultJudgment {
  const evidence=collectResultEvidence(input);const explanation=evidence.findLast((item)=>item.kind==="self-explanation" && item.accepted) ?? null;const variation=evidence.findLast((item)=>item.kind==="new-condition" && item.accepted) ?? null;
  const unitPassed=explanation!==null && variation!==null;const delayed=hasDelayedRecall(input.delayed) && !input.correctionRequired;
  const helped=input.states.some((state)=>state.diagnoses.some((diagnosis)=>diagnosis.correct===true && !diagnosis.needsHelp && diagnosis.readability==="readable" && input.facts.some((fact)=>fact.id===diagnosis.answerId && JSON.parse(fact.helpIds).length>0)) || state.editor?.reviews.some((review)=>review.output.outcome==="ready-for-recheck" && state.answers.some((answer)=>answer.id===review.output.answerId && answer.helped)));
  const performance:Performance=delayed ? "지연 재현" : variation ? "독립 수행" : helped ? "도움받아 수행" : evidence.some((item)=>item.observation!=="저장된 평가 없음") ? "설명 필요" : "미확인";
  return {unitPassed,delayedRecall:delayed ? "확인" : "미확인",progress:unitPassed ? "완료" : "진행 중",performance,explanation,variation,evidence:[...evidence],nextAction:input.correctionRequired ? "정정된 근거와 복습 질문을 확인하고 새 답안으로 재검증하세요." : unitPassed ? "다음 단원으로 진행하고, 지연 재현은 별도 복습에서 확인하세요." : !explanation ? "자료를 가리고 핵심을 자신의 말로 설명한 뒤 평가를 확인하세요." : "처음 보는 새 조건 과제를 도움 없이 풀고 평가를 확인하세요."};
}

/** 수정 전 오류와 수정 확인을 함께 보존해 개선된 답안의 과거 도움을 숨기지 않습니다. */
export function resultIssues(state:TutorState):readonly string[] {
  const editor=state.editor;
  const feedback=editor ? editor.feedbacks.flatMap((record)=>record.output.items.map((item,index)=>{const resolved=editor.reviews.some((review)=>review.output.checks.some((check)=>check.itemId===record.itemIds[index] && check.resolved));return `초안 ${editor.versions.findIndex((item)=>item.id===record.output.versionId)+1}판: ${editorIssueLabels[item.issue]} · ${resolved ? "수정본에서 확인됨" : "수정 확인 필요"}`;})) : [];
  return [...state.diagnoses.filter((item)=>(item.correct!==true || item.needsHelp)).map((item)=>item.observation),...feedback];
}
