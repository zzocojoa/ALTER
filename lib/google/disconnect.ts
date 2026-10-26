import type { SiteIdentity } from "../domain/contracts.ts";
import { googleFailure } from "./errors.ts";
import { decryptGoogleTokenBundle } from "./token-crypto.ts";
import type { GoogleTokenKeyring } from "./token-crypto.ts";
import type { GoogleOAuthRuntime } from "./oauth-exchange.ts";
import { googleDisconnectDispatchDeadlineMs } from "./disconnect-policy.ts";
import { isDomainFailure } from "../../db/repositories/atomic.ts";
import { readManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { beginGoogleDisconnect, finishGoogleDisconnect, readGoogleDisconnectStartedAt, readGoogleRevocationToken, recoverGoogleDisconnect } from "../../db/repositories/google-disconnect.ts";

export type GoogleDisconnectResult = Readonly<{ local: "disconnected"; provider: "revoked" | "failed" | "unknown"; status: number | null; issue: string | null }>;

/** 토큰 철회는 동일 토큰에 대한 멱등 요청이며 일시 장애만 최대 세 번 재시도합니다. */
export async function revokeGoogleToken(runtime: GoogleOAuthRuntime, token: string): Promise<Readonly<{ provider: GoogleDisconnectResult["provider"]; status: number | null }>> {
  if (!token || token.length > 8192) throw googleFailure("google_configuration_invalid", "revoke-token");
  for (let attempt: number = 1; attempt <= 3; attempt += 1) {
    let response: Response;
    try { response = await runtime.fetch("https://oauth2.googleapis.com/revoke", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(10_000) }); }
    catch (error: unknown) {
      if (!(error instanceof TypeError || error instanceof DOMException)) throw error;
      if (attempt === 3) return { provider: "unknown", status: null };
      const delayMs: number = 1000 * attempt; runtime.warn({ event: "google_revocation_retry", attempt, status: null, delayMs }); await runtime.wait(delayMs); continue;
    }
    await response.body?.cancel();
    if (response.status === 200) return { provider: "revoked", status: 200 };
    if (attempt === 3 || response.status !== 429 && response.status < 500) return { provider: response.status >= 500 ? "unknown" : "failed", status: response.status };
    const after: string | null = response.headers.get("retry-after");
    const delayMs: number = after === null ? 1000 * attempt : /^\d+$/.test(after) ? Number(after) * 1000 : Date.parse(after) - runtime.now();
    if (!Number.isFinite(delayMs) || delayMs > 30_000) return { provider: response.status >= 500 ? "unknown" : "failed", status: response.status };
    runtime.warn({ event: "google_revocation_retry", attempt, status: response.status, delayMs: Math.max(0, delayMs) }); await runtime.wait(Math.max(0, delayMs));
  }
  throw googleFailure("google_connection_unavailable", "revocation-attempts");
}

function completedDisconnect(current: ManagedGoogleConnection, issue: string): GoogleDisconnectResult {
  if (current.state !== "disconnected") throw googleFailure("google_connection_unavailable", "disconnect-not-completed");
  return { local: "disconnected", provider: current.providerRevocation === "revoked" ? "revoked" : current.providerRevocation === "failed" ? "failed" : "unknown", status: null, issue };
}

/** 같은 해제의 완료 경합만 수용하며 재연결된 다음 세대를 완료 결과로 반환하지 않습니다. */
async function completedAfterContention(db: D1Database, owner: SiteIdentity, pending: ManagedGoogleConnection, error: unknown): Promise<GoogleDisconnectResult> {
  if (!(isDomainFailure(error) && error.code === "version_conflict") && !(error instanceof Error && error.name === "GoogleFailure" && "operation" in error && error.operation === "disconnect-attempt-changed")) throw error;
  const current = await readManagedGoogleConnection(db, owner);
  if (current === null || current.connectionId !== pending.connectionId || current.generation !== pending.generation || current.state !== "disconnected") throw error;
  return completedDisconnect(current, "disconnect-completed-concurrently");
}

/** 중단 뒤 늦게 깨어난 이전 실행은 복구 유예가 끝난 후 제공사 철회를 새로 전송하지 않습니다. */
async function revokePendingGoogleToken(db: D1Database, owner: SiteIdentity, pending: ManagedGoogleConnection, runtime: GoogleOAuthRuntime, token: string): Promise<Readonly<{ provider: GoogleDisconnectResult["provider"]; status: number | null }>> {
  const startedAt: number = await readGoogleDisconnectStartedAt(db, owner, pending);
  const deadline: number = startedAt + googleDisconnectDispatchDeadlineMs;
  const scoped: GoogleOAuthRuntime = { ...runtime, fetch: async (url, options): Promise<Response> => {
    await readGoogleDisconnectStartedAt(db, owner, pending);
    const now: number = runtime.now();
    if (now < startedAt || now >= deadline) throw googleFailure("google_connection_unavailable", "disconnect-revocation-expired");
    const timeout: AbortSignal = AbortSignal.timeout(deadline - now);
    return runtime.fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout });
  } };
  try { return await revokeGoogleToken(scoped, token); }
  catch (error: unknown) {
    if (error instanceof Error && error.name === "GoogleFailure" && "operation" in error && error.operation === "disconnect-revocation-expired") return { provider: "unknown", status: null };
    throw error;
  }
}

/** Google 연결 해제는 Sites 로그인 상태를 변경하지 않으며 제공사 철회 실패를 별도로 반환합니다. */
export async function disconnectGoogle(db: D1Database, owner: SiteIdentity, keyring: GoogleTokenKeyring | null, runtime: GoogleOAuthRuntime, target: Readonly<{ connectionId: string; generation: number }>): Promise<GoogleDisconnectResult> {
  const current = await readManagedGoogleConnection(db, owner);
  if (current === null || current.connectionId !== target.connectionId || current.generation !== target.generation) throw googleFailure("google_connection_unavailable", "disconnect-not-connected");
  if (current.state === "disconnected") return completedDisconnect(current, "already-disconnected");
  if (current.state === "disconnecting") {
    try { await recoverGoogleDisconnect(db, owner, current, runtime.now()); }
    catch (error: unknown) { return completedAfterContention(db, owner, current, error); }
    return { local: "disconnected", provider: "unknown", status: null, issue: "interrupted-disconnect-recovered" };
  }
  let refreshToken: string | null = null; let issue: string | null = null;
  try {
    if (keyring === null) throw googleFailure("google_token_key_missing", "disconnect-key");
    const saved = await readGoogleRevocationToken(db, owner, current);
    refreshToken = (await decryptGoogleTokenBundle(saved, { ownerId: owner.userId, connectionId: current.connectionId, generation: current.generation }, keyring)).refreshToken;
  } catch (error: unknown) {
    if (!(error instanceof Error) || !("code" in error) || !["google_token_key_missing", "google_token_integrity_invalid", "google_connection_unavailable"].includes(String(error.code))) throw error;
    issue = String(error.code);
  }
  const pending = await beginGoogleDisconnect(db, owner, current, crypto.randomUUID(), runtime.now());
  const result = refreshToken === null ? { provider: "failed" as const, status: null } : await revokePendingGoogleToken(db, owner, pending, runtime, refreshToken);
  try { await finishGoogleDisconnect(db, owner, pending, result.provider); }
  catch (error: unknown) { return completedAfterContention(db, owner, pending, error); }
  return { local: "disconnected", ...result, issue };
}
