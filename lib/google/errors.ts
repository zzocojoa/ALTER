export type GoogleFailureCode = "google_quota_unverified" | "google_quota_exhausted" | "google_request_unknown" | "google_configuration_invalid" | "google_project_unverified" | "google_api_disabled" | "google_free_conditions_unverified" | "google_storage_unverified" | "google_storage_exhausted" | "google_oauth_unverified" | "google_scope_denied" | "google_oauth_state_invalid" | "google_oauth_state_unknown" | "google_identity_invalid" | "google_account_replacement_denied" | "google_token_key_missing" | "google_token_integrity_invalid" | "google_connection_unavailable";
export type GoogleFailure = Error & Readonly<{ code: GoogleFailureCode; operation: string }>;

/** 계정 비밀값과 제공사 응답 본문은 공개 오류에 포함하지 않습니다. */
export function googleFailure(code: GoogleFailureCode, operation: string): GoogleFailure {
  const messages: Readonly<Record<GoogleFailureCode, string>> = {
    google_quota_unverified: "Google API 사용 한도와 초기화 기준을 다시 확인해야 합니다.",
    google_quota_exhausted: "Google 무료 사용 한도에 도달했어요. 사용량과 초기화 시각을 확인하세요.",
    google_request_unknown: "Google 요청 결과를 확인하지 못했어요. 같은 쓰기 작업을 다시 실행하지 마세요.",
    google_configuration_invalid: "Google 운영 설정의 형식과 필수 항목을 확인하세요.",
    google_project_unverified: "선택한 Google 프로젝트의 설정을 다시 확인해야 합니다.",
    google_api_disabled: "필요한 Google API 활성화를 확인하지 못했습니다.",
    google_free_conditions_unverified: "Google 무료 조건과 유료 확장 차단 근거를 다시 확인해야 합니다.",
    google_storage_unverified: "연결한 Google 계정의 저장 용량을 다시 확인해야 합니다.",
    google_oauth_unverified: "Google 동의 화면의 게시 상태·테스트 사용자·허용 주소를 다시 확인하세요.",
    google_connection_unavailable: "현재 Google 연결을 사용할 수 없습니다. 연결 상태를 새로 확인하세요.",
    google_token_key_missing: "Google 토큰 암호화 키와 키 버전을 확인하세요.",
    google_token_integrity_invalid: "Google 저장 토큰의 무결성을 확인하지 못했습니다. 연결을 다시 확인하세요.",
    google_identity_invalid: "Google 신원 토큰을 검증하지 못했습니다. 연결을 다시 시작해 주세요.",
    google_account_replacement_denied: "다른 Google 계정은 기존 연결을 해제한 뒤 명시적으로 다시 연결해야 합니다.",
    google_oauth_state_invalid: "Google 연결 요청이 만료되었거나 이미 처리되었어요. 연결을 다시 시작해 주세요.",
    google_oauth_state_unknown: "Google 연결 요청의 저장 결과를 확인하지 못했어요. 같은 코드를 다시 전송하지 마세요.",
    google_scope_denied: "이 작업에 필요한 최소 Google 권한이 확인되지 않았습니다.",
    google_storage_exhausted: "Google 저장 용량이 부족합니다. 사용량과 진행 중인 예약을 확인하세요.",
  };
  return Object.assign(new Error(messages[code]), { name: "GoogleFailure", code, operation });
}
