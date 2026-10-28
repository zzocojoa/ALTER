import { canonicalJson } from "../domain/contracts";
import type { WeeklyFrozen } from "./view";
import type { StatusTone } from "../ui/save-status";

/** 확정 스냅샷은 불변이며 현재 근거와 내보내기 상태만 재조회에서 바뀔 수 있습니다. */
export function requireWeeklyFrozenReply(expected: WeeklyFrozen, received: WeeklyFrozen): void {
  weeklyExportPresentation(received.exportState);
  if (received.state.phase !== "confirmed" || received.state.confirmedVersionId === null || received.state.confirmedVersionId !== expected.state.confirmedVersionId || received.confirmedAt !== expected.confirmedAt || canonicalJson(received.state) !== canonicalJson(expected.state)) {
    throw new Error("요청한 확정본과 다른 기록 또는 변경된 내용이 도착했어요. 내용을 표시하지 않았으니 같은 확정본을 다시 확인해 주세요.");
  }
}

export function weeklyExportPresentation(state: string): Readonly<{ label: string; tone: StatusTone }> {
  switch (state) {
    case "pending": return { label: "내보내기 대기 · 외부 저장 미확인", tone: "neutral" };
    case "running": return { label: "내보내기 처리 중 · 외부 저장 미확인", tone: "neutral" };
    case "partial": return { label: "일부만 연동 · 전체 완료 아님", tone: "warning" };
    case "complete": return { label: "외부 연동 완료", tone: "success" };
    case "conflict": return { label: "외부 내용 충돌 · 확인 필요", tone: "warning" };
    default: throw new Error("주간 확정본의 내보내기 상태를 해석할 수 없어요. 현재 기록을 다시 확인해 주세요.");
  }
}
