import { weeklyProposal,validateWeeklyPlan } from "../weekly/planning.ts";
import type { WeeklyPlanningContext } from "../weekly/planning.ts";
import { validateEditorReviewEvidence } from "../editor/review.ts";
import { editorFeedbackOutput,editorReviewOutput } from "../editor/contracts.ts";
import { validateEditorFeedback } from "../editor/evidence.ts";
import { requiredTutorHelpStage } from "../tutor/help.ts";
import { tutorLesson,tutorDiagnosis,tutorScaffold,tutorVariation } from "../tutor/contracts.ts";
import type { TutorState } from "../tutor/contracts.ts";
import { validateTutorEvidence } from "../tutor/evidence.ts";
import { librarianEvaluation } from "../librarian/contracts.ts";
import type { CandidateSnapshot, ConfirmedUnit } from "../librarian/contracts.ts";
import { validateLibrarianEvaluation } from "../librarian/evaluation.ts";
import { advisorTurn, advisorPlan, validateAdvisorTurn, validatePlanProposal, semanticFailure } from "../advisor/contracts.ts";
import type { AdvisorState } from "../advisor/contracts.ts";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { performance, progress, recordId, version } from "../domain/contracts.ts";
import { planContent } from "../../db/repositories/courses.ts";
import { weeklyContent } from "../../db/repositories/weekly.ts";
import type { PageInput, SourceInput } from "../../db/repositories/materials.ts";
import type { ConfirmedResult } from "../../db/repositories/results.ts";
import type { AttemptInput } from "../../db/repositories/sessions.ts";

import { pageVision, validatePageVision } from "../extraction/vision-contract.ts";
import type { VisionBinding } from "../extraction/vision-contract.ts";

const text = z.string().min(1).max(12_000).regex(/\S/);
const sources = z.array(recordId).max(40);
const evidence = z.object({ resultVersionId: recordId, correctionId: recordId.nullable() }).strict();
export const helpStage = z.enum(["direction", "small-question", "similar-example", "full-explanation"]);
export type HelpStage = z.infer<typeof helpStage>;
const diagnosticQuestion = z.object({ kind: z.literal("diagnostic-question"), question: text, waitForAnswer: z.literal(true) }).strict();
const planProposal = z.object({ kind: z.literal("plan-proposal"), plan: planContent, prerequisites: z.array(text), excludedScope: z.array(text), passCriteria: z.array(z.object({ unitId: recordId, criterion: text }).strict()).min(1), requiresConfirmation: z.literal(true) }).strict();
const materialAnalysis = z.object({ kind: z.literal("material-analysis"), summary: text, sourceRefIds: sources, unverifiedPageIds: z.array(recordId), additionalExplanation: text.nullable() }).strict();
const retrievalQuestion = z.object({ kind: z.literal("retrieval-question"), question: text, sourceRefIds: sources, materialVisible: z.literal(false), explanationVisible: z.literal(false), waitForAnswer: z.literal(true) }).strict();
const tutorHelp = z.object({ kind: z.literal("tutor-help"), stage: helpStage, content: text, sourceRefIds: sources, waitForAnswer: z.literal(true) }).strict();
const editorFeedback = z.object({ kind: z.literal("editor-feedback"), answerId: recordId, items: z.array(z.object({ issue: text, evidence: text, direction: text, sourceRefIds: sources }).strict()).min(1).max(2), waitForRevisionAndReason: z.literal(true) }).strict();
const editorReview = z.object({ kind: z.literal("editor-review"), answerId: recordId, feedbackIds: z.array(recordId).min(1), result: z.enum(["needs-revision", "ready-for-recheck"]), explanation: text, sourceRefIds: sources }).strict();
const assessment = z.object({ kind: z.literal("assessment"), answerId: recordId, progress, performance, basedOnResultVersionId: recordId.nullable(), correctionId: recordId.nullable(), coreRecallAttemptId: recordId.nullable(), independentAttemptId: recordId.nullable(), delayedAttemptId: recordId.nullable(), explanation: text, nextAction: text, sourceRefIds: sources }).strict();
const reviewQuestion = z.object({ kind: z.literal("review-question"), reviewKind: z.enum(["variable", "delayed-recall"]), originalQuestionId: recordId, correctionId: recordId.nullable(), question: text, sourceRefIds: sources, waitForAnswer: z.literal(true) }).strict();
const weeklySummary = z.object({ kind: z.literal("weekly-summary"), summary: weeklyContent, evidence: z.array(evidence).min(1), minutesPerWeek: z.number().int().positive().max(10_080), adjustments: z.array(z.object({ unitId: recordId, action: z.enum(["increase-difficulty", "add-practice", "return-to-prerequisite"]), evidence: z.array(evidence).min(1), reason: text }).strict()), analogy: z.object({ example: text, similarities: text, differences: text, limitations: text, distinction: z.literal("analogy-not-established-fact") }).strict(), requiresConfirmation: z.literal(true) }).strict();
const correctionProposal = z.object({ kind: z.literal("correction-proposal"), errorId: recordId, basedOnCorrectionId: recordId.nullable(), reason: text, sourceRefIds: sources.min(1), targets: z.array(z.object({ reviewId: recordId, expectedVersion: version, question: text, explanation: text, nextAction: text }).strict()).min(1), requiresConfirmation: z.literal(true) }).strict();
const learningVariants = [diagnosticQuestion, planProposal, materialAnalysis, retrievalQuestion, tutorHelp, editorFeedback, editorReview, assessment, reviewQuestion, weeklySummary, correctionProposal] as const;
export const legacyLearningOutput = z.object({ result: z.discriminatedUnion("kind", learningVariants) }).strict();
export const visionOutput = z.object({ result: pageVision }).strict();
export const learningOutput = z.object({ result: z.discriminatedUnion("kind", [...learningVariants, pageVision, advisorTurn, advisorPlan, librarianEvaluation,tutorLesson,tutorDiagnosis,tutorScaffold,tutorVariation,editorFeedbackOutput,editorReviewOutput,weeklyProposal]) }).strict();
export type LearningOutput = z.infer<typeof learningOutput>;
export type LearningKind = LearningOutput["result"]["kind"];
export const learningFormat = zodTextFormat(legacyLearningOutput, "alter_learning_response");
export const visionFormat = zodTextFormat(visionOutput, "alter_page_vision");
export const advisorTurnFormat = zodTextFormat(z.object({ result: advisorTurn }).strict(), "alter_advisor_turn");
export const advisorPlanFormat = zodTextFormat(z.object({ result: advisorPlan }).strict(), "alter_advisor_plan");
export const librarianFormat = zodTextFormat(z.object({ result: librarianEvaluation }).strict(), "alter_librarian_evaluation");
export const tutorLessonFormat=zodTextFormat(z.object({result:tutorLesson}).strict(),"alter_tutor_lesson");
export const tutorDiagnosisFormat=zodTextFormat(z.object({result:tutorDiagnosis}).strict(),"alter_tutor_diagnosis");
export const tutorScaffoldFormat=zodTextFormat(z.object({result:tutorScaffold}).strict(),"alter_tutor_scaffold");
export const tutorVariationFormat=zodTextFormat(z.object({result:tutorVariation}).strict(),"alter_tutor_variation");
export const editorRevisionFormat=zodTextFormat(z.object({result:editorReviewOutput}).strict(),"alter_editor_review");
export const editorFeedbackFormat=zodTextFormat(z.object({result:editorFeedbackOutput}).strict(),"alter_editor_feedback");
export const weeklyFormat=zodTextFormat(z.object({result:weeklyProposal}).strict(),"alter_weekly_review");
export function formatForKind(kind: LearningKind | undefined): typeof learningFormat | typeof visionFormat | typeof advisorTurnFormat | typeof advisorPlanFormat | typeof librarianFormat | typeof tutorLessonFormat | typeof tutorDiagnosisFormat | typeof tutorScaffoldFormat | typeof tutorVariationFormat | typeof editorFeedbackFormat | typeof editorRevisionFormat | typeof weeklyFormat {
  if(kind==="weekly-review") return weeklyFormat;
  if(kind==="editor-revision-review") return editorRevisionFormat;
  if(kind==="editor-draft-feedback") return editorFeedbackFormat;
  if(kind==="tutor-lesson") return tutorLessonFormat;
  if(kind==="tutor-diagnosis") return tutorDiagnosisFormat;
  if(kind==="tutor-scaffold") return tutorScaffoldFormat;
  if(kind==="tutor-variation") return tutorVariationFormat;
  if (kind === "librarian-evaluation") return librarianFormat;
  if (kind === "page-vision") return visionFormat;
  if (kind === "advisor-turn") return advisorTurnFormat;
  if (kind === "advisor-plan") return advisorPlanFormat;
  return learningFormat;
}
export type AttemptEvidence = Readonly<AttemptInput & { answerId: string; helped: boolean; explanationHidden: boolean; correct: boolean; performedAt: number; correctionId: string | null }>;
export type ConfirmedEvidence = Readonly<{ resultVersionId: string; correctionId: string | null }>;
export type ReviewVersion = Readonly<{ reviewId: string; version: number }>;
export type LearningContext = Readonly<{
  weekly?: WeeklyPlanningContext;
  tutor?: TutorState;
  librarian?: Readonly<{ unit: ConfirmedUnit; candidates: readonly CandidateSnapshot[] }>;
  extractionPage?: VisionBinding;
  advisor?: AdvisorState;
  pages: readonly PageInput[];
  sources: readonly SourceInput[];
  unitIds: readonly string[];
  latestResult: ConfirmedResult | null;
  latestEvidence: readonly ConfirmedEvidence[];
  attempts: readonly AttemptEvidence[];
  currentCorrectionId: string | null;
  expectedHelpStage: HelpStage;
  feedbackIds: readonly string[];
  revision: Readonly<{ answerId: string; text: string; reason: string; feedbackIds: readonly string[] }> | null;
  relatedReviews: readonly ReviewVersion[];
  errorId: string | null;
  availableMinutesPerWeek: number;
  delayedRecallDueAt: number | null;
}>;
export type SemanticRule = "source_missing" | "source_mismatch" | "record_version" | "help_order" | "answer_missing" | "editor_revision_required" | "independent_evidence" | "delayed_evidence" | "correction_targets" | "plan_scope" | "weekly_evidence" | "tutor_evidence" | "editor_evidence";
export type LearningSemanticFailure = Error & Readonly<{ code: "ai_semantic_invalid"; rule: SemanticRule }>;

function fail(rule: SemanticRule): never {
  throw Object.assign(new Error("AI 응답이 현재 확정 기록 또는 학습 규칙과 일치하지 않습니다."), { name: "LearningSemanticFailure", code: "ai_semantic_invalid" as const, rule });
}

/** 서버가 소유권을 확인해 읽은 자료·페이지·원문 구간과 대조합니다. */
export function validateSourceReferences(ids: readonly string[], context: LearningContext): void {
  if (new Set(ids).size !== ids.length) fail("source_mismatch");
  for (const id of ids) {
    const source: SourceInput | undefined = context.sources.find((item): boolean => item.id === id);
    if (!source) fail("source_missing");
    const page: PageInput | undefined = context.pages.find((item): boolean => item.id === source.pageId);
    if (!page || page.materialId !== source.materialId || page.uploadId !== source.uploadId || page.filePage !== source.filePage || page.printedPage !== source.printedPage || Array.from(page.content).slice(source.spanStart, source.spanEnd).join("") !== source.evidence) fail("source_mismatch");
  }
}

function requireAnswer(answerId: string, context: LearningContext): AttemptEvidence {
  const attempt: AttemptEvidence | undefined = context.attempts.find((item): boolean => item.answerId === answerId);
  if (!attempt) fail("answer_missing");
  return attempt;
}

function requireUnassistedAttempt(id: string | null, context: LearningContext): AttemptEvidence {
  const attempt: AttemptEvidence | undefined = context.attempts.find((item): boolean => item.id === id);
  if (!attempt || !attempt.correct || attempt.helped || !attempt.hiddenMaterial || !attempt.explanationHidden || attempt.correctionId !== context.currentCorrectionId) fail("independent_evidence");
  return attempt;
}

/** 완료 상태를 결정하지 않고, 수정본·이유와 모든 피드백의 대응 증거만 검증합니다. */
export function validateEditorReview(value: z.infer<typeof editorReview>, context: LearningContext): void {
  requireAnswer(value.answerId, context);
  const revision: LearningContext["revision"] = context.revision;
  if (!revision || revision.answerId !== value.answerId || !revision.text.trim() || !revision.reason.trim() || context.feedbackIds.length === 0) fail("editor_revision_required");
  if (value.feedbackIds.length !== context.feedbackIds.length || new Set(value.feedbackIds).size !== value.feedbackIds.length || context.feedbackIds.some((id): boolean => !value.feedbackIds.includes(id as z.infer<typeof recordId>) || !revision.feedbackIds.includes(id))) fail("editor_revision_required");
}

export function validateAssessment(value: z.infer<typeof assessment>, context: LearningContext): void {
  requireAnswer(value.answerId, context);
  if (value.basedOnResultVersionId !== (context.latestResult?.id ?? null) || value.correctionId !== context.currentCorrectionId) fail("record_version");
  const needsIndependence: boolean = value.performance === "독립 수행" || value.performance === "지연 재현" || value.progress === "완료";
  if (needsIndependence) {
    if (value.performance !== "독립 수행" && value.performance !== "지연 재현") fail("independent_evidence");
    const independent: AttemptEvidence = requireUnassistedAttempt(value.independentAttemptId, context);
    const recall: AttemptEvidence = requireUnassistedAttempt(value.coreRecallAttemptId, context);
    if (independent.mode !== "new-condition" || !independent.originalQuestionId || independent.questionId === independent.originalQuestionId || recall.id === independent.id || recall.mode !== "initial" || recall.questionId !== independent.originalQuestionId || recall.performedAt >= independent.performedAt) fail("independent_evidence");
    if (value.performance === "독립 수행" && independent.answerId !== value.answerId) fail("independent_evidence");
    if (value.performance === "지연 재현") {
      const delayed: AttemptEvidence = requireUnassistedAttempt(value.delayedAttemptId, context);
      if (delayed.mode !== "delayed-recall" || delayed.id === independent.id || delayed.answerId === independent.answerId || delayed.answerId !== value.answerId || delayed.performedAt <= independent.performedAt || context.delayedRecallDueAt === null || delayed.performedAt < context.delayedRecallDueAt) fail("delayed_evidence");
    }
  }
  if (context.feedbackIds.length > 0 && (!context.revision?.reason.trim() || !context.revision.text.trim() || context.feedbackIds.some((id): boolean => !context.revision?.feedbackIds.includes(id)))) fail("editor_revision_required");
}

function validateConfirmedEvidence(values: readonly ConfirmedEvidence[], context: LearningContext): void {
  if (values.length === 0 || new Set(values.map((value): string => value.resultVersionId)).size !== values.length || values.some((value): boolean => !context.latestEvidence.some((item): boolean => item.resultVersionId === value.resultVersionId && item.correctionId === value.correctionId))) fail("weekly_evidence");
}

export function validateWeeklySummary(value: z.infer<typeof weeklySummary>, context: LearningContext): void {
  validateConfirmedEvidence(value.evidence, context);
  if (value.minutesPerWeek > context.availableMinutesPerWeek) fail("plan_scope");
  for (const item of value.adjustments) {
    if (!context.unitIds.includes(item.unitId)) fail("plan_scope");
    validateConfirmedEvidence(item.evidence, context);
  }
}

export function validateCorrectionProposal(value: z.infer<typeof correctionProposal>, context: LearningContext): void {
  if (value.errorId !== context.errorId || value.basedOnCorrectionId !== context.currentCorrectionId) fail("record_version");
  if (value.targets.length !== context.relatedReviews.length || new Set(value.targets.map((item): string => item.reviewId)).size !== value.targets.length || value.targets.some((item): boolean => !context.relatedReviews.some((known): boolean => known.reviewId === item.reviewId && known.version === item.expectedVersion))) fail("correction_targets");
}

/** 스키마와 의미를 검증한 제안만 반환하며 학습 확정·도움 이력·외부 상태를 변경하지 않습니다. */
export function validateLearningOutput(raw: unknown, expectedKind: LearningKind, context: LearningContext): LearningOutput {
  const output: LearningOutput = learningOutput.parse(raw);
  const result: LearningOutput["result"] = output.result;
  if (result.kind !== expectedKind) fail("record_version");
  if ("sourceRefIds" in result) validateSourceReferences(result.sourceRefIds, context);
  switch (result.kind) {
    case "weekly-review":if(!context.weekly) fail("weekly_evidence");try{validateWeeklyPlan(result,context.weekly);}catch(error:unknown){if(error instanceof Error && "code" in error && ["reference_conflict","validation"].includes(String(error.code))) fail("weekly_evidence");throw error;}break;
    case "editor-revision-review":if(!context.tutor) fail("answer_missing");try {validateEditorReviewEvidence(context.tutor,result);}catch(error:unknown){if(error instanceof Error && "code" in error && error.code==="reference_conflict") fail("editor_evidence");throw error;}break;
    case "editor-draft-feedback":if(!context.tutor) fail("answer_missing");try {validateEditorFeedback(context.tutor,result);}catch(error:unknown){if(error instanceof Error && "code" in error && error.code==="reference_conflict") fail("editor_evidence");throw error;}break;
    case "tutor-lesson":case "tutor-diagnosis":case "tutor-scaffold":case "tutor-variation":if(!context.tutor) fail("answer_missing");try {validateTutorEvidence(context.tutor,result);} catch(error:unknown) {if(error instanceof Error && "code" in error && error.code==="reference_conflict") fail("tutor_evidence");throw error;}if(result.kind==="tutor-scaffold" && result.stage!==requiredTutorHelpStage(context.tutor)) fail("help_order");break;
    case "librarian-evaluation": if (!context.librarian) fail("source_missing"); validateLibrarianEvaluation(result, context.librarian.unit, context.librarian.candidates); break;
    case "advisor-turn": if (!context.advisor) throw semanticFailure("advisor-missing"); validateAdvisorTurn(result, context.advisor); break;
    case "advisor-plan": if (!context.advisor || context.advisor.phase !== "planning" || context.advisor.pending?.kind !== "advisor-plan") throw semanticFailure("advisor-phase"); validatePlanProposal(result.proposal, context.advisor.conditions); break;
    case "page-vision": if (!context.extractionPage) fail("source_missing"); validatePageVision(result, context.extractionPage); break;
    case "diagnostic-question": break;
    case "material-analysis": if (result.unverifiedPageIds.some((id): boolean => !context.pages.some((page): boolean => page.id === id))) fail("source_missing"); break;
    case "retrieval-question": break;
    case "tutor-help": if (result.stage !== context.expectedHelpStage) fail("help_order"); break;
    case "editor-feedback": requireAnswer(result.answerId, context); for (const item of result.items) validateSourceReferences(item.sourceRefIds, context); break;
    case "editor-review": validateEditorReview(result, context); break;
    case "assessment": validateAssessment(result, context); break;
    case "review-question": if (result.correctionId !== context.currentCorrectionId || !context.attempts.some((attempt): boolean => attempt.questionId === result.originalQuestionId)) fail("record_version"); break;
    case "weekly-summary": validateWeeklySummary(result, context); break;
    case "correction-proposal": validateCorrectionProposal(result, context); break;
    case "plan-proposal":
      if (result.plan.minutesPerWeek > context.availableMinutesPerWeek || result.plan.unitIds.some((id): boolean => !context.unitIds.includes(id)) || result.passCriteria.length !== result.plan.unitIds.length || new Set(result.passCriteria.map((item): string => item.unitId)).size !== result.passCriteria.length || result.passCriteria.some((item): boolean => !result.plan.unitIds.includes(item.unitId))) fail("plan_scope");
      break;
  }
  return output;
}
