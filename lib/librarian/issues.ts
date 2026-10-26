import type { SourceRejection } from "../extraction/source.ts";
import type { CandidateSnapshot } from "./contracts.ts";

const sourceActions: Readonly<Record<SourceRejection, string>> = {
  deleted: "원본과 판독 기록을 찾을 수 없어요. 등록 상태를 확인하고 구간을 다시 연결해 주세요.",
  "other-owner": "소유자가 일치하지 않아요. 본인의 확인된 자료를 선택해 주세요.",
  "material-mismatch": "다른 자료의 구간이에요. 이 판본의 원본에서 다시 선택해 주세요.",
  "original-replaced": "원본 판본이 바뀌었어요. 새 원본과 대조한 구간을 연결해 주세요.",
  "stale-result": "판독 결과 또는 페이지 선택이 바뀌었어요. 최신 결과를 확인하고 다시 연결해 주세요.",
  "wrong-page": "원본 페이지가 일치하지 않아요. 파일 쪽수를 확인해 주세요.",
  "segment-missing": "선택 구간이 없어졌어요. 최신 본문에서 다시 선택해 주세요.",
  unreadable: "읽을 수 없는 구간이에요. 원본과 대조해 정정하거나 다른 확인 구간을 선택해 주세요.",
  unconfirmed: "본문 대조가 끝나지 않았어요. 해당 구간을 원본과 확인한 뒤 다시 연결해 주세요.",
  "outside-span": "인용이 확인한 구간을 벗어나요. 정확한 텍스트 구간을 다시 선택해 주세요.",
};
export function sourceRecheckAction(reason: SourceRejection): string { return sourceActions[reason]; }
/** 확인된 저장소·원본 부재만 보류 상태로 변환하며 권한·미지의 서버 오류는 호출자에게 전달합니다. */
export function knownSourceAccessIssue(error: unknown): string | null {
  if (!(error instanceof Error) || error.name !== "MaterialFailure" || !("field" in error) || !("status" in error)) return null;
  if (error.field === "registered-material-not-found" && error.status === 404) return "등록된 원본에 접근할 수 없어요. 자료 등록 상태와 소유권을 확인해 주세요.";
  if (error.status === 409 && ["object-missing", "object-version-mismatch", "object-identity-mismatch"].includes(String(error.field))) return "원본이 없거나 저장된 판본과 달라요. 원본 접근을 복구하고 대조한 구간으로 다시 연결해 주세요.";
  return null;
}
export type MaterialIssue = Readonly<{ linkId: string | null; materialId: string | null; action: string }>;
export function materialIssues(candidates: readonly CandidateSnapshot[]): readonly MaterialIssue[] {
  if (candidates.length === 0) return [{ linkId: null, materialId: null, action: "이 단원에 연결된 자료가 없어요. 필요한 페이지 또는 텍스트 구간을 선택해 주세요." }];
  return candidates.flatMap((candidate): MaterialIssue[] => [
    ...(!candidate.valid ? [{ linkId: candidate.link.id, materialId: candidate.link.materialId, action: candidate.reason ?? "본문 구간을 확인해 주세요." }] : []),
    ...(!candidate.link.bibliography.checked ? [{ linkId: candidate.link.id, materialId: candidate.link.materialId, action: "저자·출처·판본의 근거가 미확인이에요. 본문 확인과 별도로 서지 근거를 확인해 주세요." }] : []),
  ]);
}
