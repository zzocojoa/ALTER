export type GoogleConnectionView = Readonly<{
  configured: boolean;
  configurationIssue: string | null;
  connection: Readonly<{ connectionId: string; generation: number; email: string; state: "active" | "partial" | "refreshing" | "refresh-unknown" | "reconsent" | "disconnecting" | "disconnected"; filesAllowed: boolean; calendarAllowed: boolean; refreshExpiresAt: number | null; providerRevocation: "none" | "pending" | "revoked" | "failed" | "unknown" }> | null;
}>;

const outcomes: Readonly<Record<string, string>> = { connected: "Google 계정이 연결되었어요.", partial: "일부 권한이 승인되지 않았어요. 필요한 기능은 다시 연결한 뒤 사용할 수 있어요.", denied: "Google 연결 동의를 취소했어요. 기존 학습 기록은 그대로예요.", failed: "Google 연결을 완료하지 못했어요. 설정과 연결 상태를 확인한 뒤 다시 시작해 주세요.", unknown: "Google 연결 결과를 확인하지 못했어요. 먼저 현재 연결 상태를 새로 확인해 주세요." };
export function googleConnectionOutcome(outcome: string | null, connection: GoogleConnectionView["connection"]): string | null {
  if (outcome === null || !Object.hasOwn(outcomes, outcome) || connection?.state === "disconnected" || connection?.state === "disconnecting" || outcome === "connected" && connection?.state !== "active" || outcome === "partial" && connection?.state !== "partial") return null;
  return outcomes[outcome];
}
export function googleConnectionCanUseData(connection: GoogleConnectionView["connection"]): boolean {
  return connection?.state === "active" || connection?.state === "partial";
}
