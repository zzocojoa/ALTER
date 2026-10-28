import { expect, test } from "@playwright/test";
import { initialEditor, recordEditorDraft } from "../../lib/editor/state";
import { beginEditorFeedback } from "../../lib/editor/feedback";
import { finishEditorSession } from "../../lib/editor/review";
import { submitEditorRevision } from "../../lib/editor/revision";
import { publicEditorView } from "../../lib/editor/view";
import { saveTutorAnswer } from "../../lib/tutor/state";
import { beginTutorVariation, finishTutorVariation } from "../../lib/tutor/variation";
import type { TutorState } from "../../lib/tutor/contracts";
import { editorWaitingFixture, editorReadyFixture } from "../fixtures/editor-state";
import { tutorId, tutorStartFixture } from "../fixtures/tutor-state";
import { tutorOutputFixture } from "../fixtures/tutor-output";
import { mountEditorView } from "../fixtures/editor-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

function editorPhases(): readonly Readonly<{ state: TutorState; step: string | null; title: string }>[] {
  const draft: TutorState = initialEditor(tutorId(11), tutorStartFixture(), tutorId(12), tutorId(13));
  const saved: TutorState = recordEditorDraft(saveTutorAnswer({ ...draft, draft: { text: "3/8입니다.", fileIds: [] } }, { id: tutorId(14), questionId: draft.question.id, attemptId: draft.question.attemptId, text: "3/8입니다.", fileIds: [], submittedAt: 1, helped: false }));
  const revision: TutorState = submitEditorRevision(editorWaitingFixture(), { answerId: tutorId(30), attemptId: tutorId(31), draft: { text: "같은 크기 네 조각 중 한 조각", fileIds: [] }, reason: "전체와 부분 구분", submittedAt: 3 });
  const ready: TutorState = editorReadyFixture();
  const pending: TutorState = beginTutorVariation(ready);
  const output = tutorOutputFixture(pending);
  if (output.kind !== "tutor-variation") throw new Error("새 조건 검사 입력이 아닙니다.");
  const variation: TutorState = finishTutorVariation(pending, output, tutorId(90), tutorId(91));
  return [
    { state: draft, step: "초안 작성·제출", title: "먼저 나의 초안을 써 주세요" },
    { state: saved, step: "피드백", title: "제출한 초안의 피드백을 받을 차례예요" },
    { state: beginEditorFeedback(saved), step: "피드백", title: "이미 요청한 AI 결과의 확인이 필요해요" },
    { state: editorWaitingFixture(), step: "수정본·이유", title: "직접 고친 문장과 수정 이유를 적어 주세요" },
    { state: revision, step: "재검토", title: "저장한 수정본과 이유를 재검토할 차례예요" },
    { state: ready, step: "새 조건 수행", title: "새 조건에서 직접 풀어볼 차례예요" },
    { state: variation, step: "새 조건 수행", title: "자료를 가리고 새 조건을 풀어 주세요" },
    { state: finishEditorSession(ready), step: null, title: "첨삭 기록을 보관했어요" },
  ];
}

for (const phase of editorPhases()) {
  test(`저장된 단계와 다음 행동: ${phase.title}`, async ({ page }, info): Promise<void> => {
    await mountEditorView(page, publicEditorView(phase.state));
    const flow = page.getByRole("region", { name: "첨삭 진행 단계" });
    await expect(flow.getByRole("heading", { name: phase.title, exact: true })).toBeVisible();
    await expect(flow.getByRole("listitem")).toHaveCount(5);
    if (phase.step === null) await expect(flow.locator('[aria-current="step"]')).toHaveCount(0);
    else await expect(flow.locator('[aria-current="step"]')).toContainText(phase.step);
    await expect(flow.getByRole("button")).toHaveCount(0);
    expect(await page.evaluate((): boolean => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (phase.state.editor?.phase === "variation") {
      await expect(flow.getByText("이전 기록 가림", { exact: true })).toHaveCount(4);
      expect(await page.locator("body").innerText()).not.toContain("1/4은 네 조각");
    }
    if (phase.state.editor?.phase === "awaiting-revision") {
      await checkAccessibility(page, ".editor-flow", info);
      await page.screenshot({ path: `outputs/ui-editor/steps-o1-${info.project.name}.png`, fullPage: true });
    }
    expect(await page.pageErrors()).toEqual([]);
  });
}
