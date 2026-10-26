/** 제공사 철회의 최대 재시도 90초보다 긴 유예 뒤에만 중단된 로컬 해제를 정리합니다. */
export const googleDisconnectRecoveryDelayMs: number = 120_000;
export const googleDisconnectDispatchDeadlineMs: number = 90_000;
