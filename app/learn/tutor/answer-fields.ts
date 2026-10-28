import { reviewFields } from "@/lib/reviews/submission";
import { parseReviewSubmission } from "@/lib/reviews/submission";
import { tutorDraft } from "@/lib/tutor/contracts";
import type { LearningType } from "@/lib/reviews/contracts";
import type { TutorView } from "@/lib/tutor/view";

export type ReviewAnswerField = Readonly<{ key: string; label: string; value: string }>;

/** 기존 서버 제출 형식을 그대로 읽고 입력 문자열을 잘라내지 않습니다. */
export function readReviewAnswers(type: LearningType, text: string): readonly ReviewAnswerField[] {
  const fields = reviewFields[type];
  return fields.map((field, index): ReviewAnswerField => {
    const from: number = text.indexOf(`${field.label}: `);
    const next = fields[index + 1];
    const to: number = next ? text.indexOf(`\n${next.label}: `) : text.length;
    return { ...field, value: from < 0 ? "" : text.slice(from + field.label.length + 2, to < 0 ? text.length : to) };
  });
}

/** 초안은 빈 필드를 허용하지만 글자 제한을 넘긴 입력은 현재 화면에만 둡니다. */
export function tutorDraftInputIssue(view: TutorView, text: string): string | null {
  if (!tutorDraft.shape.text.safeParse(text).success) return "답안은 60,000자 이내로 줄여 주세요. 초과한 입력은 이 화면에만 남아 있어요.";
  if (view.review && view.question.mode !== "new-condition") {
    const over = readReviewAnswers(view.review.task.type, text).find((field): boolean => field.value.length > 6000);
    if (over) return `${over.label}은 6,000자 이내로 줄여 주세요. 초과한 입력은 이 화면에만 남아 있어요.`;
  }
  return null;
}

/** 필드별 필수 값과 새 조건 규칙은 서버의 제출 검사와 같은 함수를 사용합니다. */
export function tutorSubmissionIssue(view: TutorView, text: string, fileCount: number): string | null {
  const draftIssue: string | null = tutorDraftInputIssue(view, text);
  if (draftIssue) return draftIssue;
  if (view.review && view.question.mode !== "new-condition") {
    const empty = readReviewAnswers(view.review.task.type, text).find((field): boolean => !field.value.trim());
    if (empty) return `${empty.label}을 직접 작성해 주세요.`;
    try { parseReviewSubmission(view.review.task, text); }
    catch (cause: unknown) {
      if (!(cause instanceof Error) || !("operation" in cause) || !["review.required-submission-fields", "review.fresh-condition-required"].includes(String(cause.operation))) throw cause;
      return "원문제와 다른 새 예시·조건으로 작성해 주세요.";
    }
  }
  return text.trim() || fileCount > 0 ? null : "답안을 작성하거나 풀이 사진을 첨부해 주세요.";
}
