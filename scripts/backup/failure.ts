export type PreflightIssue = Readonly<{ code: string; location: string; expected: string; actual: string }>;
export type PreflightFailure = Error & Readonly<{ issue: PreflightIssue }>;

/** 오류 보고서에는 파일 본문이나 인증값을 넣지 않습니다. */
export function preflightFailure(code: string, location: string, expected: string, actual: string): PreflightFailure {
  return Object.assign(new Error(`복원 전 검증 실패: ${code} (${location})`), { name: "PreflightFailure", issue: { code, location, expected, actual } });
}
export function requirePreflight(condition: boolean, code: string, location: string, expected: string, actual: string): void {
  if (!condition) throw preflightFailure(code, location, expected, actual);
}
