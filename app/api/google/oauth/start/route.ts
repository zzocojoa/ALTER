import { env } from "cloudflare:workers";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleErrorResponse, googleServerSettings } from "@/lib/google/server";
import { googleAttemptCookie, googleAuthorizationUrl, oauthPurpose, prepareGoogleOAuthAttempt } from "@/lib/google/oauth-state";
import { googleFailure } from "@/lib/google/errors";
import { readManagedGoogleConnection } from "@/db/repositories/google-managed";
import { saveGoogleOAuthAttempt } from "@/db/repositories/google-oauth";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const purpose = oauthPurpose.parse(await readBoundedJson(request, 2048));
    const settings = googleServerSettings(access.owner);
    const current = await readManagedGoogleConnection(env.DB, access.owner);
    if (current?.state === "disconnecting" || (current === null ? purpose.kind !== "connect" : purpose.kind !== "reconnect" || purpose.connectionId !== current.connectionId || purpose.generation !== current.generation)) throw googleFailure("google_connection_unavailable", "oauth-start-generation");
    const start = await prepareGoogleOAuthAttempt(access.owner, settings.oauth, purpose, Date.now());
    await saveGoogleOAuthAttempt(env.DB, access.owner, start.attempt);
    const response = privateJson({ authorizationUrl: googleAuthorizationUrl(settings.oauth, start) }, 200); response.headers.set("Set-Cookie", googleAttemptCookie(start.handle)); return response;
  } catch (error: unknown) { return googleErrorResponse(error); }
}
