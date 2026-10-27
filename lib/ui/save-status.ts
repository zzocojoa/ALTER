export type StatusTone = "neutral" | "success" | "warning" | "danger";
export type SaveState = Readonly<{ kind: "idle" | "dirty" | "saving" }> | Readonly<{ kind: "saved" | "submitted"; version: number }> | Readonly<{ kind: "error" | "unknown" | "conflict"; detail: string }>;
export type SavePresentation = Readonly<{ label: string; detail: string | null; tone: StatusTone; persistence: "unconfirmed" | "draft" | "answer" }>;

function versionLabel(version: number): string {
  if (!Number.isSafeInteger(version) || version < 1) throw new RangeError("저장 확인에는 서버가 반환한 양의 정수 기록 판이 필요합니다.");
  return "기록 " + version + "판";
}

/** 입력 이벤트나 경과 시간으로 성공을 추정하지 않고 호출자가 확인한 상태만 표현합니다. */
export function savePresentation(state: SaveState): SavePresentation {
  switch (state.kind) {
    case "idle": return { label: "입력을 기다리고 있어요", detail: null, tone: "neutral", persistence: "unconfirmed" };
    case "dirty": return { label: "아직 저장하지 않은 입력이 있어요", detail: null, tone: "warning", persistence: "unconfirmed" };
    case "saving": return { label: "서버에 초안을 저장하고 있어요", detail: null, tone: "neutral", persistence: "unconfirmed" };
    case "saved": return { label: "서버 초안 저장을 확인했어요", detail: versionLabel(state.version) + " · 답안 제출은 별도예요.", tone: "success", persistence: "draft" };
    case "submitted": return { label: "답안 제출을 확인했어요", detail: versionLabel(state.version) + " · AI 처리와 결과 확정은 별도예요.", tone: "success", persistence: "answer" };
    case "error": return { label: "저장하지 못했어요", detail: state.detail, tone: "danger", persistence: "unconfirmed" };
    case "unknown": return { label: "저장 결과가 아직 확인되지 않았어요", detail: state.detail, tone: "warning", persistence: "unconfirmed" };
    case "conflict": return { label: "다른 화면의 변경을 확인해 주세요", detail: state.detail, tone: "warning", persistence: "unconfirmed" };
    default: throw new TypeError("지원하지 않는 저장 상태입니다.");
  }
}
