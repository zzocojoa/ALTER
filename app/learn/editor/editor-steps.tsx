import type { ReactElement } from "react";
import type { EditorView } from "@/lib/editor/view";

type EditorStep = "draft" | "feedback" | "revision" | "review" | "transfer";
type EditorPhaseCopy = Readonly<{ step: EditorStep; title: string; detail: string }>;
const steps: readonly Readonly<{ id: EditorStep; label: string }>[] = [
  { id: "draft", label: "초안 작성·제출" }, { id: "feedback", label: "피드백" }, { id: "revision", label: "수정본·이유" }, { id: "review", label: "재검토" }, { id: "transfer", label: "새 조건 수행" },
];
const phaseCopy: Readonly<Record<EditorView["phase"], EditorPhaseCopy>> = {
  draft: { step: "draft", title: "먼저 나의 초안을 써 주세요", detail: "자기 말로 작성한 글이나 사진을 제출한 뒤 피드백을 요청할 수 있어요." },
  "draft-saved": { step: "feedback", title: "제출한 초안의 피드백을 받을 차례예요", detail: "초안은 저장됐어요. 피드백 요청과 API 비용 발생 여부는 다음 행동에서 확인해요." },
  "awaiting-revision": { step: "revision", title: "직접 고친 문장과 수정 이유를 적어 주세요", detail: "피드백의 핵심을 확인하고, 무엇을 왜 바꿨는지 수정본과 함께 제출해요." },
  "revision-saved": { step: "review", title: "저장한 수정본과 이유를 재검토할 차례예요", detail: "제출 완료와 개선 평가는 별도예요. 아래에서 저장한 수정본의 재검토를 요청할 수 있어요." },
  "ready-for-recheck": { step: "transfer", title: "새 조건에서 직접 풀어볼 차례예요", detail: "첨삭의 개선 확인만으로 독립 수행이 확정되지 않아요. 새로운 조건의 답안으로 확인해요." },
  variation: { step: "transfer", title: "자료를 가리고 새 조건을 풀어 주세요", detail: "이전 초안과 피드백은 가린 상태예요. 현재 질문에 대한 직접 답안을 저장해요." },
};

function storedStepLabel(step: EditorStep, view: EditorView): string {
  if (view.historyHidden && step !== "transfer") return "이전 기록 가림";
  if (step === "draft" && view.versions.length > 0) return "제출 기록 있음";
  if (step === "feedback" && view.feedbacks.length > 0) return "피드백 기록 있음";
  if (step === "revision" && view.versions.some((item): boolean => item.parentId !== null)) return "수정본 제출 기록 있음";
  if (step === "review" && view.reviews.length > 0) return "평가 기록 있음";
  if (step === "transfer" && view.transfer !== null) return "수행 답안 기록 있음";
  return "저장 기록 없음";
}

/** 저장 상태를 읽어 진행 위치만 표시하며 단계 선택으로 제출·AI 호출을 실행하지 않습니다. */
export function EditorSteps({ view }: Readonly<{ view: EditorView }>): ReactElement {
  const copy: EditorPhaseCopy = phaseCopy[view.phase];
  const finished: boolean = view.tutor.phase === "finished";
  const pending: boolean = view.tutor.pending !== null;
  const paused: boolean = view.tutor.phase === "paused";
  return <section className="editor-flow" aria-label="첨삭 진행 단계">
    <p className="editor-flow-eyebrow">내 글 고치기 · 기록 {view.tutor.version}판</p>
    <h2>{finished ? "첨삭 기록을 보관했어요" : pending ? "이미 요청한 AI 결과의 확인이 필요해요" : paused ? "새 조건 수행을 잠시 멈췄어요" : copy.title}</h2>
    <p>{finished ? "이력과 종료 상태를 확인해 주세요. 개선 완료나 독립 수행 확정과는 별도예요." : pending ? "현재 제출 기록을 유지해요. 아래의 기존 요청 결과 확인에서 이어갈 수 있어요." : paused ? "같은 질문에서 이어갈 수 있어요. 이전 초안과 피드백은 계속 가려요." : copy.detail}</p>
    <ol className="editor-step-list" aria-label="초안부터 새 조건까지">
      {steps.map((step, index): ReactElement => <li key={step.id} aria-current={!finished && step.id === copy.step ? "step" : undefined}><span className="editor-step-number" aria-hidden="true">{index + 1}</span><span>{step.label}<small>{!finished && step.id === copy.step ? pending ? "요청 결과 확인 대기" : "지금 진행할 단계" : storedStepLabel(step.id, view)}</small></span></li>)}
    </ol>
  </section>;
}
