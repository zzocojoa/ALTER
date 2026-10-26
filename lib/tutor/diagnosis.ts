import type { TutorDiagnosis } from "./contracts.ts";

export const TUTOR_DIAGNOSIS_CONFLICT_MESSAGE="AI 진단의 정답 여부와 도움 필요 여부가 서로 맞지 않아요. 이 진단은 수행 근거로 사용하지 않아요. ‘답안 다시 쓰기’에서 답안을 저장한 뒤 다시 진단해 주세요. 이전 답안과 비용 기록은 보존돼요.";

/** 저장된 과거 응답도 읽을 수 있게 두되 모순된 진단을 수행 근거에서 제외합니다. */
export function hasTutorDiagnosisConflict(diagnosis:TutorDiagnosis|null):boolean {
  return diagnosis?.correct===true && diagnosis.needsHelp;
}
