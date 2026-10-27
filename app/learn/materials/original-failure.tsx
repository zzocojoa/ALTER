import type { ReactElement } from "react";
import { isMaterialResponseFailure } from "./client-api";

/** 원본 처리에서 직접 작성한 안전한 안내만 화면에 전달합니다. */
export function originalFailure(message: string): Error {
  return Object.assign(new Error(message), { name: "OriginalPreviewFailure" });
}

export function originalErrorText(error: unknown): string {
  if (isMaterialResponseFailure(error)) {
    if (error.field === "material-hidden-during-recall") return "자료를 가리고 답하는 중이에요. 답안을 제출한 뒤 원본을 열 수 있어요. (403)";
    const messages: Readonly<Record<number, string>> = { 401: "로그인이 만료됐어요. 다시 로그인한 뒤 이어서 진행해 주세요.", 403: "이 자료에 접근할 권한이 없어요.", 404: "확정된 자료를 찾을 수 없어요.", 409: "원본 상태가 변경됐어요. 자료 목록을 새로 확인해 주세요.", 416: "요청한 원본 범위를 읽을 수 없어요.", 422: "파일 내용이 손상됐거나 지원하지 않는 형식이에요." };
    return `${messages[error.status] ?? "원본 서버의 응답을 확인하지 못했어요. 잠시 후 목록에서 다시 열어 주세요."} (HTTP ${error.status})`;
  }
  if (error instanceof AggregateError) return originalErrorText(error.errors[0]);
  if (error instanceof Error && error.name === "OriginalPreviewFailure") return error.message;
  if (error instanceof Error && error.message.includes("does not match the Worker version")) return "PDF 작업 파일 버전이 달라요. 새로고침한 뒤 다시 열어 주세요.";
  if (error instanceof TypeError) return "원본을 가져오지 못했어요. 네트워크 연결을 확인한 뒤 목록에서 다시 열어 주세요.";
  if (error instanceof ReferenceError) return "이 브라우저에서 원본 처리 기능을 실행할 수 없어요. Web Worker·캔버스 지원을 확인해 주세요.";
  return "원본 처리 중 오류가 발생했어요. 자료 목록에서 원본을 다시 확인해 주세요.";
}

export function OriginalFailure({ filePage, detail }: Readonly<{ filePage: number; detail: string }>): ReactElement {
  return <div className="alter-original-failure" role="alert"><p><strong>파일 {filePage}페이지 원본을 열지 못했어요.</strong></p><p>{detail}</p><p>‘자료 목록으로’ 돌아가 상태를 확인한 뒤 다시 열어 주세요. 확대 창은 왼쪽 위 ‘자료로’로 나올 수 있어요.</p></div>;
}
