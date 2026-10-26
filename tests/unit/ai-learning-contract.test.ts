import { describe, expect, it } from "vitest";
import { recordId } from "../../lib/domain/contracts";
import { learningFormat, learningOutput, validateLearningOutput } from "../../lib/ai/learning-contract";
import type { AttemptEvidence, LearningContext, LearningKind } from "../../lib/ai/learning-contract";

function id(value: number): ReturnType<typeof recordId.parse> { return recordId.parse(`00000000-0000-4000-8000-${String(value).padStart(12, "0")}`); }
const recalled: AttemptEvidence = { id: id(10), sessionId: id(11), questionId: id(12), originalQuestionId: null, mode: "initial", hiddenMaterial: true, answerId: id(13), helped: false, explanationHidden: true, correct: true, performedAt: 10, correctionId: null };
const independent: AttemptEvidence = { ...recalled, id: id(20), questionId: id(22), originalQuestionId: recalled.questionId, mode: "new-condition", answerId: id(23), performedAt: 20 };
const delayed: AttemptEvidence = { ...independent, id: id(30), questionId: id(32), mode: "delayed-recall", answerId: id(33), performedAt: 50 };
const context: LearningContext = Object.freeze({
  pages: [{ id: id(1), materialId: id(2), uploadId: id(3), filePage: 1, printedPage: "i", content: "공식 근거" }],
  sources: [{ id: id(4), materialId: id(2), uploadId: id(3), pageId: id(1), filePage: 1, printedPage: "i", spanStart: 0, spanEnd: 5, evidence: "공식 근거" }],
  unitIds: [id(5)], latestResult: null, latestEvidence: [{ resultVersionId: id(6), correctionId: null }], attempts: [recalled, independent, delayed], currentCorrectionId: null,
  expectedHelpStage: "direction", feedbackIds: [], revision: null, relatedReviews: [{ reviewId: id(7), version: 1 }], errorId: id(8), availableMinutesPerWeek: 120, delayedRecallDueAt: 40,
});
const samples = {
  "diagnostic-question": { kind: "diagnostic-question", question: "설명해 주세요.", waitForAnswer: true },
  "plan-proposal": { kind: "plan-proposal", plan: { objective: "이해하기", unitIds: [id(5)], minutesPerWeek: 60 }, prerequisites: ["기초"], excludedScope: ["고급"], passCriteria: [{ unitId: id(5), criterion: "독립 설명과 변형 문제" }], requiresConfirmation: true },
  "material-analysis": { kind: "material-analysis", summary: "선택 구간", sourceRefIds: [id(4)], unverifiedPageIds: [], additionalExplanation: null },
  "retrieval-question": { kind: "retrieval-question", question: "기억에서 설명해 주세요.", sourceRefIds: [id(4)], materialVisible: false, explanationVisible: false, waitForAnswer: true },
  "tutor-help": { kind: "tutor-help", stage: "direction", content: "조건을 살펴보세요.", sourceRefIds: [id(4)], waitForAnswer: true },
  "editor-feedback": { kind: "editor-feedback", answerId: id(13), items: [{ issue: "근거", evidence: "답안의 주장", direction: "출처와 연결", sourceRefIds: [id(4)] }], waitForRevisionAndReason: true },
  "editor-review": { kind: "editor-review", answerId: id(13), feedbackIds: [id(9)], result: "ready-for-recheck", explanation: "변형 과제로 다시 확인", sourceRefIds: [id(4)] },
  "assessment": { kind: "assessment", answerId: id(23), progress: "완료", performance: "독립 수행", basedOnResultVersionId: null, correctionId: null, coreRecallAttemptId: id(10), independentAttemptId: id(20), delayedAttemptId: null, explanation: "자료 없이 새 조건 수행", nextAction: "나중에 별도 확인", sourceRefIds: [id(4)] },
  "review-question": { kind: "review-question", reviewKind: "variable", originalQuestionId: id(12), correctionId: null, question: "새 사례를 설명해 주세요.", sourceRefIds: [id(4)], waitForAnswer: true },
  "weekly-summary": { kind: "weekly-summary", summary: { achievements: "수행", difficulties: "어려움", improvements: "개선", nextActions: "다음 행동" }, evidence: [{ resultVersionId: id(6), correctionId: null }], minutesPerWeek: 60, adjustments: [{ unitId: id(5), action: "add-practice", evidence: [{ resultVersionId: id(6), correctionId: null }], reason: "실습 반복" }], analogy: { example: "다른 분야", similarities: "공통", differences: "차이", limitations: "적용 범위", distinction: "analogy-not-established-fact" }, requiresConfirmation: true },
  "correction-proposal": { kind: "correction-proposal", errorId: id(8), basedOnCorrectionId: null, reason: "근거 수정", sourceRefIds: [id(4)], targets: [{ reviewId: id(7), expectedVersion: 1, question: "정정 질문", explanation: "정정 설명", nextAction: "재검증" }], requiresConfirmation: true },
} as const;
const editedContext: LearningContext = { ...context, feedbackIds: [id(9)], revision: { answerId: id(13), text: "수정한 답", reason: "근거 정정", feedbackIds: [id(9)] } };

function validate(kind: LearningKind, value: object, current: LearningContext): void { validateLearningOutput({ result: value }, kind, current); }

describe("AI 학습 응답의 구조·의미 경계", (): void => {
  it("기존 학습 응답 형식은 strict 구조와 실제 저장소 타입으로 검증한다", (): void => {
    for (const kind of Object.keys(samples) as (keyof typeof samples)[]) {
      const value = samples[kind];
      expect(() => validate(kind, value, kind === "editor-review" ? editedContext : context)).not.toThrow();
      expect(learningOutput.safeParse({ result: { ...value, arbitraryAction: "execute" } }).success).toBe(false);
      expect(learningOutput.safeParse({ result: { ...value, kind: "unknown" } }).success).toBe(false);
      expect(learningOutput.safeParse({ result: { kind } }).success).toBe(false);
    }
    expect(learningFormat.type).toBe("json_schema");
    expect(learningFormat.strict).toBe(true);
  });
  it("없는 출처, 다른 페이지·판본·근거 구간을 거부한다", (): void => {
    expect(() => validate("retrieval-question", { ...samples["retrieval-question"], sourceRefIds: [id(99)] }, context)).toThrow(expect.objectContaining({ rule: "source_missing" }));
    for (const source of [{ ...context.sources[0], filePage: 2 }, { ...context.sources[0], printedPage: "1" }, { ...context.sources[0], evidence: "다른 근거" }, { ...context.sources[0], uploadId: id(99) }]) {
      expect(() => validate("retrieval-question", samples["retrieval-question"], { ...context, sources: [source] })).toThrow(expect.objectContaining({ rule: "source_mismatch" }));
    }
  });
  it("질문 뒤 대기와 자료·설명 숨기기를 강제한다", (): void => {
    for (const changed of [{ waitForAnswer: false }, { materialVisible: true }, { explanationVisible: true }, { answer: "완성 답" }]) expect(() => validate("retrieval-question", { ...samples["retrieval-question"], ...changed }, context)).toThrow();
    expect(() => validate("tutor-help", { ...samples["tutor-help"], stage: "full-explanation" }, context)).toThrow(expect.objectContaining({ rule: "help_order" }));
    expect(context.expectedHelpStage).toBe("direction");
  });
  it("Editor 피드백은 1~2개이며 완성 답안을 추가하지 못한다", (): void => {
    for (const items of [[], Array(3).fill(samples["editor-feedback"].items[0])]) expect(() => validate("editor-feedback", { ...samples["editor-feedback"], items }, context)).toThrow();
    expect(() => validate("editor-feedback", { ...samples["editor-feedback"], completeAnswer: "정답" }, context)).toThrow();
    expect(() => validate("editor-review", samples["editor-review"], context)).toThrow(expect.objectContaining({ rule: "editor_revision_required" }));
    expect(() => validate("editor-review", samples["editor-review"], { ...editedContext, revision: { ...editedContext.revision!, reason: " " } })).toThrow(expect.objectContaining({ rule: "editor_revision_required" }));
  });
  it("도움받은 같은 답안이나 자료를 본 답안은 독립 수행으로 승격하지 못한다", (): void => {
    for (const changed of [{ helped: true }, { hiddenMaterial: false }, { explanationHidden: false }, { questionId: recalled.questionId }, { mode: "initial" as const }, { correct: false }]) {
      expect(() => validate("assessment", samples.assessment, { ...context, attempts: [recalled, { ...independent, ...changed }, delayed] })).toThrow(expect.objectContaining({ rule: "independent_evidence" }));
    }
    expect(() => validate("assessment", { ...samples.assessment, answerId: recalled.answerId }, context)).toThrow(expect.objectContaining({ rule: "independent_evidence" }));
  });
  it("지연 재현은 별도의 늦은 답안과 예정 시각 증거가 필요하다", (): void => {
    const result = { ...samples.assessment, performance: "지연 재현", answerId: delayed.answerId, delayedAttemptId: delayed.id };
    expect(() => validate("assessment", result, context)).not.toThrow();
    for (const current of [{ ...context, delayedRecallDueAt: null }, { ...context, delayedRecallDueAt: 51 }, { ...context, attempts: [recalled, independent, { ...delayed, performedAt: 20 }] }]) expect(() => validate("assessment", result, current)).toThrow(expect.objectContaining({ rule: "delayed_evidence" }));
  });
  it("최신 확정 버전·정정 버전이 다르면 과거 결과를 사용하지 않는다", (): void => {
    expect(() => validate("assessment", { ...samples.assessment, basedOnResultVersionId: id(99) }, context)).toThrow(expect.objectContaining({ rule: "record_version" }));
    expect(() => validate("assessment", samples.assessment, { ...context, currentCorrectionId: id(99) })).toThrow(expect.objectContaining({ rule: "record_version" }));
    expect(() => validate("correction-proposal", { ...samples["correction-proposal"], basedOnCorrectionId: id(99) }, context)).toThrow(expect.objectContaining({ rule: "record_version" }));
  });
  it("정정은 관련 복습 전체와 정확한 버전을 명시해야 한다", (): void => {
    expect(() => validate("correction-proposal", samples["correction-proposal"], { ...context, relatedReviews: [{ reviewId: id(7), version: 2 }] })).toThrow(expect.objectContaining({ rule: "correction_targets" }));
    expect(() => validate("correction-proposal", samples["correction-proposal"], { ...context, relatedReviews: [...context.relatedReviews, { reviewId: id(99), version: 1 }] })).toThrow(expect.objectContaining({ rule: "correction_targets" }));
  });
  it("주간 조정은 최신 확정 근거와 실제 가용 시간 안에서만 제안한다", (): void => {
    expect(() => validate("weekly-summary", { ...samples["weekly-summary"], evidence: [{ resultVersionId: id(99), correctionId: null }] }, context)).toThrow(expect.objectContaining({ rule: "weekly_evidence" }));
    expect(() => validate("weekly-summary", { ...samples["weekly-summary"], minutesPerWeek: 121 }, context)).toThrow(expect.objectContaining({ rule: "plan_scope" }));
    expect(() => validate("weekly-summary", samples["weekly-summary"], { ...context, latestEvidence: [{ resultVersionId: id(6), correctionId: id(99) }] })).toThrow(expect.objectContaining({ rule: "weekly_evidence" }));
  });
});
