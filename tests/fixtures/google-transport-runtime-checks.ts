import { exportJWK, generateKeyPair } from "jose";
import { exchangeGoogleCode, exchangeGoogleRefresh, loadGoogleSigningKeys } from "../../lib/google/oauth-exchange.ts";
import type { GoogleOAuthRuntime } from "../../lib/google/oauth-exchange.ts";
import { revokeGoogleToken } from "../../lib/google/disconnect.ts";
import { prepareGoogleRestRequest } from "../../lib/google/rest-request.ts";
import { sendGoogleRestAttempt } from "../../lib/google/rest-transport.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }

/** 모의 응답 전에도 workerd의 실제 Request 생성자를 통과시켜 Node 전용 옵션을 검출합니다. */
export async function checkGoogleTransportRuntime(now: number): Promise<readonly string[]> {
  const pair = await generateKeyPair("RS256", { extractable: true });
  const key = await exportJWK(pair.publicKey);
  const body: string = JSON.stringify({ keys: [{ kty: key.kty, n: key.n, e: key.e, kid: "runtime-key", use: "sig", alg: "RS256" }] });
  const calls: string[] = [];
  const runtime: GoogleOAuthRuntime = { now: () => now, wait: async () => {}, warn: () => {}, fetch: async (url, options) => {
    const request: Request = new Request(url, options); ensure(request.redirect === "manual", "리디렉션 자동 추적 허용"); calls.push(url);
    if (url.endsWith("/certs")) return new Response(body, { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "1" } });
    if (url.endsWith("/revoke")) return new Response(null, { status: 200 });
    return Response.json({ error: "invalid_client" }, { status: 401 });
  } };
  await loadGoogleSigningKeys(runtime);
  const oauth = fixtureGoogleOAuth(now);
  const attempt = { id: "00000000-0000-4000-a000-000000001400", nonceHash: "a".repeat(64), callbackUrl: oauth.callbackUrl, purpose: { kind: "connect" as const } };
  for (const run of [() => exchangeGoogleCode(runtime, oauth, attempt, "fixture-code", "fixture-secret", null), () => exchangeGoogleRefresh(runtime, oauth.clientId, "fixture-secret", "fixture-refresh", null)]) {
    let rejected: boolean = false;
    try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "google_oauth_transport_failed" && "status" in error && error.status === 401) rejected = true; else throw error; }
    ensure(rejected, "인증 요청 생성 또는 오류 분류 실패");
  }
  ensure((await revokeGoogleToken(runtime, "fixture-refresh")).provider === "revoked", "철회 요청 생성 실패");
  const rest = await prepareGoogleRestRequest({ method: "drive.about.get" }, "account");
  const result = await sendGoogleRestAttempt({ now: () => now, wait: async () => {}, warn: () => {}, fetch: async (url, options) => { const request: Request = new Request(url, options); ensure(request.redirect === "manual", "REST 리디렉션 자동 추적"); return new Response('{"storageQuota":{"limit":"10","usage":"1"}}', { headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "1" } }); } }, rest, "fixture-access");
  ensure(result.status === 200, "REST 압축 본문 오류");
  let redirects: number = 0; let denied: boolean = false;
  try { await loadGoogleSigningKeys({ ...runtime, fetch: async (url, options) => { new Request(url, options); redirects += 1; return new Response(null, { status: 302, headers: { location: "https://untrusted.invalid/" } }); } }); } catch (error: unknown) { if (error instanceof Error && "status" in error && error.status === 302) denied = true; else throw error; }
  ensure(denied && redirects === 1, "제공사 리디렉션 추적 또는 재시도");
  ensure(calls.filter(url => url.endsWith("/token")).length === 2, "인증 오류 자동 재시도");
  return ["workerd-request-options-oauth-rest-revoke", "decoded-gzip-response-keeps-byte-limit", "provider-redirect-rejected-without-follow"];
}
