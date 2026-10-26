import { env } from "cloudflare:workers";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { googleErrorResponse, googleOAuthRuntime, googleServerSettings } from "@/lib/google/server";
import { expireGoogleAttemptCookie, readGoogleAttemptCookie } from "@/lib/google/oauth-state";
import { exchangeGoogleCode } from "@/lib/google/oauth-exchange";
import { googleFailure } from "@/lib/google/errors";
import { encryptGoogleTokenBundle } from "@/lib/google/token-crypto";
import { consumeGoogleOAuthAttempt } from "@/db/repositories/google-oauth";
import { prepareGoogleConnectionWrite, readManagedGoogleConnection, saveManagedGoogleConnection } from "@/db/repositories/google-managed";
export const dynamic = "force-dynamic";
function callbackRedirect(outcome: "connected" | "partial" | "denied" | "failed" | "unknown"): Response {
  return new Response(null, { status: 303, headers: { Location: `/learn/google?connection=${outcome}`, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", Vary: "Cookie", "Set-Cookie": expireGoogleAttemptCookie() } });
}
export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection) { access.rejection.headers.set("Set-Cookie", expireGoogleAttemptCookie()); return access.rejection; }
  try {
    const settings = googleServerSettings(access.owner);
    const url: URL = new URL(request.url);
    if (url.origin !== settings.oauth.origin || url.searchParams.getAll("state").length !== 1 || url.searchParams.getAll("code").length > 1 || url.searchParams.getAll("error").length > 1) throw googleFailure("google_oauth_state_invalid", "callback-parameters");
    const attempt = await consumeGoogleOAuthAttempt(env.DB, access.owner, url.searchParams.get("state") ?? "", readGoogleAttemptCookie(request.headers.get("cookie")), settings.oauth.callbackUrl, Date.now());
    if (url.searchParams.get("error") === "access_denied" && !url.searchParams.has("code")) return callbackRedirect("denied");
    if (url.searchParams.has("error") || !url.searchParams.has("code")) throw googleFailure("google_oauth_state_invalid", "callback-code");
    const current = await readManagedGoogleConnection(env.DB, access.owner);
    if (current?.state === "disconnecting" || (current === null ? attempt.purpose.kind !== "connect" : attempt.purpose.kind !== "reconnect" || attempt.purpose.connectionId !== current.connectionId || attempt.purpose.generation !== current.generation)) throw googleFailure("google_connection_unavailable", "callback-generation");
    const candidate = await exchangeGoogleCode(googleOAuthRuntime(), settings.oauth, attempt, url.searchParams.get("code") ?? "", settings.clientSecret, current?.googleSubject ?? null);
    const plan = await prepareGoogleConnectionWrite(env.DB, access.owner, candidate.identity.subject, attempt.purpose);
    const token = await encryptGoogleTokenBundle({ accessToken: candidate.accessToken, refreshToken: candidate.refreshToken, authorizedAt: candidate.authorizedAt }, plan.binding, settings.keyring);
    await saveManagedGoogleConnection(env.DB, plan, attempt.id, { subject: candidate.identity.subject, email: candidate.identity.email, scopes: [...candidate.scopes], accessExpiresAt: candidate.accessExpiresAt, refreshExpiresAt: candidate.refreshExpiresAt, authorizedAt: candidate.authorizedAt }, token);
    return callbackRedirect(candidate.scopes.length === 4 ? "connected" : "partial");
  } catch (error: unknown) {
    const response = googleErrorResponse(error);
    console.warn({ event: "google_oauth_callback_failed", status: response.status, code: error instanceof Error && "code" in error ? String(error.code) : "input_invalid", operation: error instanceof Error && "operation" in error ? String(error.operation) : null, providerStatus: error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : null, providerError: error instanceof Error && "providerError" in error ? error.providerError : null });
    const unknown: boolean = error instanceof Error && ("outcome" in error && error.outcome === "unknown" || "code" in error && error.code === "result_unknown");
    return callbackRedirect(unknown ? "unknown" : "failed");
  }
}
