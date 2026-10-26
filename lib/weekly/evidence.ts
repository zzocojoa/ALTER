import { z } from "zod";
import { recordId,timestamp,version,domainFailure,contentHash } from "../domain/contracts.ts";
import { tutorState } from "../tutor/contracts.ts";
import { resultJudgment } from "../results/contracts.ts";
import { weeklyPeriod,withinWeek } from "./period.ts";
import type { WeeklyPeriod } from "./period.ts";

export const weeklySession=z.object({sessionId:recordId,resultVersionId:recordId,resultOrdinal:version,sessionVersion:version,confirmedAt:timestamp,state:tutorState,judgment:resultJudgment}).strict();
export type WeeklySession=Readonly<z.infer<typeof weeklySession>>;
export const weeklyAnswerRow=z.object({id:recordId,sessionId:recordId,questionId:recordId,attemptId:recordId,version,text:z.string(),submittedAt:timestamp,hidden:z.number().int(),mode:z.string(),status:z.string(),helpIds:z.array(recordId)}).strict();
export type WeeklyAnswerRow=Readonly<z.infer<typeof weeklyAnswerRow>>;
export const weeklyReviewRow=z.object({id:recordId,unitId:recordId,version,errorId:recordId,answerId:recordId,concept:z.string(),question:z.string(),explanation:z.string(),nextAction:z.string(),correctionId:recordId.nullable(),recheckState:z.string()}).strict();
export type WeeklyReviewRow=Readonly<z.infer<typeof weeklyReviewRow>>;
export const weeklyCorrectionRow=z.object({id:recordId,errorId:recordId,unitId:recordId,answerId:recordId,createdAt:timestamp.nullable(),reason:z.string(),evidence:z.string()}).strict();
export type WeeklyCorrectionRow=Readonly<z.infer<typeof weeklyCorrectionRow>>;
export const weeklyEditorEvidence=z.object({versionId:recordId,feedbackId:recordId,reviewId:recordId,reason:z.string().min(1),resolvedItemIds:z.array(recordId),needsRevision:z.boolean()}).strict();
export const weeklyAnswerEvidence=z.object({id:recordId,sessionId:recordId,sessionVersion:version,resultVersionId:recordId,resultOrdinal:version,confirmedAt:timestamp,answerVersion:version,submittedAt:timestamp,questionId:recordId,unitId:recordId,unitTitle:z.string(),prompt:z.string(),text:z.string(),sourceRefIds:z.array(recordId),helpIds:z.array(recordId),helped:z.boolean(),correct:z.boolean().nullable(),accepted:z.boolean(),needsRecheck:z.boolean(),mode:z.enum(["self-explanation","practice","new-condition"]),observation:z.string(),reviewId:recordId.nullable(),delayedRecall:z.boolean(),correctionId:recordId.nullable(),correctionRechecked:z.boolean(),editorRevision:weeklyEditorEvidence.nullable()}).strict();
export type WeeklyAnswerEvidence=Readonly<z.infer<typeof weeklyAnswerEvidence>>;
export const weeklyAggregate=z.object({period:weeklyPeriod,courseId:recordId,confirmedSessions:z.array(z.object({id:recordId,resultVersionId:recordId,resultOrdinal:version,sessionVersion:version,confirmedAt:timestamp}).strict()),answers:z.array(weeklyAnswerEvidence),reviews:z.array(weeklyReviewRow),corrections:z.array(weeklyCorrectionRow),counts:z.object({sessions:z.number().int().nonnegative(),answers:z.number().int().nonnegative(),independentNewConditions:z.number().int().nonnegative(),independentExplanations:z.number().int().nonnegative(),helpedAnswers:z.number().int().nonnegative(),incorrectAnswers:z.number().int().nonnegative(),delayedRecall:z.number().int().nonnegative(),correctionRechecks:z.number().int().nonnegative(),editorImprovements:z.number().int().nonnegative()}).strict(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type WeeklyAggregate=Readonly<z.infer<typeof weeklyAggregate>>;
export type WeeklyCollection=Readonly<{period:WeeklyPeriod;courseId:string;sessions:readonly WeeklySession[];answers:readonly WeeklyAnswerRow[];reviews:readonly WeeklyReviewRow[];corrections:readonly WeeklyCorrectionRow[]}>;

function answerEvidence(input:WeeklyCollection,session:WeeklySession):readonly WeeklyAnswerEvidence[] {
  const state=session.state;const unit=state.start.bundle.unit;
  if(state.id!==session.sessionId || state.version!==session.sessionVersion+1 || state.phase!=="finished" || unit.courseId!==input.courseId) throw domainFailure("reference_conflict","weekly.confirmation-state",{sessionId:session.sessionId});
  return state.answers.map((answer):WeeklyAnswerEvidence=>{
    const stored=input.answers.find(item=>item.id===answer.id);const question=state.questions.find(item=>item.id===answer.questionId);
    if(!stored || !question || stored.sessionId!==session.sessionId || stored.questionId!==answer.questionId || stored.attemptId!==answer.attemptId || stored.text!==(answer.text.length ? answer.text : "[사진 답안]") || stored.submittedAt!==answer.submittedAt || stored.submittedAt>session.confirmedAt || stored.status!=="ready") throw domainFailure("reference_conflict","weekly.confirmed-answer-reference",{sessionId:session.sessionId,answerId:answer.id});
    const proof=session.judgment.evidence.find(item=>item.answerId===answer.id && item.sessionId===session.sessionId);
    if(proof && (proof.answerVersion!==stored.version || proof.questionId!==question.id)) throw domainFailure("reference_conflict","weekly.answer-version",{answerId:answer.id});
    const helpIds=[...new Set([...stored.helpIds,...(proof?.helpIds ?? []),...state.help.filter(item=>item.questionId===question.id).map(item=>item.id)])].sort();
    const corrections=input.corrections.filter(item=>item.unitId===unit.unitId);
    const needsRecheck=corrections.some(item=>item.createdAt===null || item.createdAt>=answer.submittedAt) || proof?.accepted===true && (helpIds.length>0 || stored.hidden!==1);
    const accepted=proof?.accepted===true && stored.hidden===1 && !answer.helped && helpIds.length===0 && !needsRecheck;
    const diagnosis=state.diagnoses.findLast(item=>item.answerId===answer.id);
    if(proof?.accepted && (!diagnosis || diagnosis.correct!==true || diagnosis.readability!=="readable" || diagnosis.needsHelp)) throw domainFailure("reference_conflict","weekly.accepted-diagnosis-missing",{answerId:answer.id});
    const editorReview=state.editor?.reviews.findLast(item=>item.output.answerId===answer.id);
    const editorVersion=state.editor?.versions.find(item=>item.answerId===answer.id && item.id===editorReview?.output.versionId);
    if(editorReview && (!editorVersion?.reason || editorVersion.feedbackId!==editorReview.output.feedbackId)) throw domainFailure("reference_conflict","weekly.editor-revision-reason",{answerId:answer.id});
    const editorRevision=editorReview && editorVersion?.reason ? weeklyEditorEvidence.parse({versionId:editorVersion.id,feedbackId:editorReview.output.feedbackId,reviewId:editorReview.id,reason:editorVersion.reason,resolvedItemIds:editorReview.output.checks.filter(item=>item.resolved).map(item=>item.itemId),needsRevision:editorReview.output.outcome!=="ready-for-recheck"}) : null;
    const review=state.review && input.reviews.find(item=>item.id===state.review?.reviewId);
    const correctionRechecked=Boolean(accepted && question.mode==="new-condition" && state.review?.correctionId && review?.correctionId===state.review.correctionId && ["independent","delayed"].includes(review.recheckState));
    const delayedRecall=Boolean(accepted && stored.mode==="delayed-recall" && state.review?.kind==="delayed-recall" && session.judgment.delayedRecall==="확인" && session.judgment.performance==="지연 재현");
    return weeklyAnswerEvidence.parse({id:answer.id,sessionId:session.sessionId,sessionVersion:session.sessionVersion,resultVersionId:session.resultVersionId,resultOrdinal:session.resultOrdinal,confirmedAt:session.confirmedAt,answerVersion:stored.version,submittedAt:answer.submittedAt,questionId:question.id,unitId:unit.unitId,unitTitle:unit.title,prompt:question.prompt,text:stored.text,sourceRefIds:question.sourceRefIds,helpIds,helped:answer.helped || helpIds.length>0,correct:diagnosis?.correct ?? (editorReview ? editorReview.output.outcome==="ready-for-recheck" : null),accepted,needsRecheck,mode:question.mode,observation:diagnosis?.observation ?? (editorRevision ? editorRevision.needsRevision ? "수정본의 추가 개선 필요" : "수정 이유와 개선 내용 확인됨 · 독립 수행은 별도" : "저장된 평가 없음"),reviewId:state.review?.reviewId ?? null,delayedRecall,correctionId:state.review?.correctionId ?? null,correctionRechecked,editorRevision});
  });
}
/** 공식 확정에 포함된 실제 답안만 한 번 집계하고 현재 정정·도움 기록을 함께 보존합니다. */
export async function aggregateWeeklyEvidence(input:WeeklyCollection):Promise<WeeklyAggregate> {
  recordId.parse(input.courseId);weeklyPeriod.parse(input.period);
  const sessions=input.sessions.map(item=>weeklySession.parse(item)).filter(item=>withinWeek(input.period,item.confirmedAt));
  const selected=[...new Map(sessions.map(item=>[item.sessionId,item])).values()];
  if(selected.length!==sessions.length) throw domainFailure("reference_conflict","weekly.duplicate-confirmed-session",null);
  const candidates=selected.flatMap(item=>answerEvidence(input,item));const answers=[...new Map(candidates.map(item=>[item.id,item])).values()];
  if(answers.length!==candidates.length) throw domainFailure("reference_conflict","weekly.duplicate-confirmed-answer",null);
  const confirmedSessions=selected.map(item=>({id:item.sessionId,resultVersionId:item.resultVersionId,resultOrdinal:item.resultOrdinal,sessionVersion:item.sessionVersion,confirmedAt:item.confirmedAt}));
  const data={period:input.period,courseId:input.courseId,confirmedSessions,answers,reviews:input.reviews,corrections:input.corrections,counts:{sessions:selected.length,answers:answers.length,independentNewConditions:answers.filter(item=>item.accepted && item.mode==="new-condition").length,independentExplanations:answers.filter(item=>item.accepted && item.mode==="self-explanation" && !item.delayedRecall).length,helpedAnswers:answers.filter(item=>item.helped).length,incorrectAnswers:answers.filter(item=>item.correct===false).length,delayedRecall:answers.filter(item=>item.delayedRecall).length,correctionRechecks:answers.filter(item=>item.correctionRechecked).length,editorImprovements:answers.filter(item=>!item.needsRecheck && item.editorRevision && item.editorRevision.resolvedItemIds.length>0).length}};
  return weeklyAggregate.parse({...data,fingerprint:await contentHash(data)});
}
