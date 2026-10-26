export const RESTORE_DIAGNOSTIC_MESSAGE: string = "복원 검증 환경에서는 외부 작업을 포함한 전체 저장·비용 검사를 실행할 수 없어요. 이 검사는 원본 학습 공간에서 진행해 주세요. 임시 기록은 만들지 않았어요.";

/** 거부된 진단을 성공으로 대체하지 않고 사용자가 조치할 수 있는 오류로 표시합니다. */
export function diagnosticFailure(status: number): Error {
  return new Error(status === 423 ? `${RESTORE_DIAGNOSTIC_MESSAGE} (HTTP 423)` : `진단 응답 HTTP ${status}. 로그인 상태와 서버 검사 기록을 확인해 주세요.`);
}
