import { requireCurrentExecutionAuthority } from "@/db/repositories/restore-execution";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { contentHash, recordId, version } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleApiServerSettings, googleErrorResponse, googleOAuthRuntime } from "@/lib/google/server";
import { requireGoogleAccessToken } from "@/lib/google/access-token";
import { googleFailure } from "@/lib/google/errors";
import { prepareGooglePickerCredentials, requireGooglePickerEvidence } from "@/lib/google/picker";
import { prepareGoogleQuota } from "@/lib/google/quota";
import { googleStorageEvidence } from "@/lib/google/project";
import { beginGoogleRequest, finishGoogleRequest, installGoogleQuotaPolicy, reserveGoogleRequest } from "@/db/repositories/google-quota";
import { saveGooglePickerLease } from "@/db/repositories/google-resources";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const input = z.object({ role: z.enum(["reference", "docs-target", "sheets-target"]), connectionId: recordId, generation: version }).strict().parse(await readBoundedJson(request, 2048));
    const settings = googleApiServerSettings(access.owner);
    await requireCurrentExecutionAuthority(env.DB, access.owner);
    await requireGooglePickerEvidence(settings.picker, settings.execution.project, settings.apiKey, access.owner.userId, env.ALTER_SITE_ORIGIN ?? "", Date.now());
    const token = await requireGoogleAccessToken(env.DB, access.owner, settings.execution.credentials, googleOAuthRuntime());
    if (token.connection.connectionId !== input.connectionId || token.connection.generation !== input.generation) throw googleFailure("google_connection_unavailable", "picker-target");
    const now: number = Date.now(); const plan = await prepareGoogleQuota(settings.execution.quota, settings.execution.project, access.owner.userId, token.connection.googleSubject, "picker.open", now);
    const storage = googleStorageEvidence.parse(token.connection.storageEvidence === null ? null : JSON.parse(token.connection.storageEvidence));
    const attemptId: string = materialRequestKey(request.headers); const requestHash: string = await contentHash({ method: "picker.open", ...input });
    await installGoogleQuotaPolicy(env.DB, access.owner, settings.execution.quota);
    await reserveGoogleRequest(env.DB, access.owner, token.connection, plan, { attemptId, requestHash, storageBytes: 0, now }, storage);
    const credentials = prepareGooglePickerCredentials(token.connection, settings.picker, settings.apiKey, token.token, crypto.randomUUID(), now);
    await saveGooglePickerLease(env.DB, access.owner, credentials, input.role, now);
    await beginGoogleRequest(env.DB, access.owner, attemptId, requestHash, Date.now());
    await finishGoogleRequest(env.DB, access.owner, attemptId, { state: "unknown", status: null, errorCode: "picker-browser-issued", externalId: null, now: Date.now() });
    return privateJson(credentials, 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
