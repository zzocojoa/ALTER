import { isMaterialResponseFailure } from "./client-api";

export type UploadIssue = Readonly<{ kind: "interrupted" | "unknown" | "capacity" | "conflict" | "rejected"; title: string; detail: string }>;

/** 서버의 실패 코드와 전송 중단을 구분하며 미확정 결과를 성공이나 삭제로 바꾸지 않습니다. */
export function uploadIssue(error: unknown, interrupted: boolean): UploadIssue {
  if (interrupted) return { kind: "interrupted", title: "전송을 중단했어요", detail: "서버에 원본이 남아 있을 수 있어요. 상태 확인으로 같은 요청을 이어가거나 확인 후 임시 자료를 정리해 주세요." };
  if (isMaterialResponseFailure(error)) {
    if (error.status === 507) return { kind: "capacity", title: "저장 공간이 부족해요", detail: "전체 256 MiB에는 보관된 원본과 미확정 예약도 포함돼요. 기존 요청을 확인하고 저장 공간을 다시 확인해 주세요." };
    if (error.status === 409) return { kind: "conflict", title: error.code === "request_key_reused" ? "같은 요청의 내용이 달라요" : "기존 등록 요청 확인이 필요해요", detail: "새 요청을 만들지 않았어요. 원래 선택한 파일과 제목을 유지하고 기존 요청의 상태를 확인해 주세요. 같은 제목만으로 중복 파일로 판단하지 않아요." };
    if (error.status < 500) return { kind: "rejected", title: "요청이 거부됐어요", detail: "아래 오류의 형식·권한·크기 조건을 확인해 주세요. 선택한 파일과 입력은 유지했어요." };
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string" && error.code.startsWith("material_")) return { kind: "rejected", title: "파일 검사에 실패했어요", detail: "지원 형식과 파일 제한을 확인해 주세요. 검사에 실패한 원본은 전송하지 않았어요." };
  return { kind: "unknown", title: "등록 완료를 확인하지 못했어요", detail: "결과가 불명확한 요청은 완료가 아니에요. 같은 요청의 상태를 확인해 주세요. 자동 재전송이나 임시 파일 정리는 하지 않아요." };
}
