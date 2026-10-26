import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId, version } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleApiServerSettings, googleErrorResponse, googleExecutionRuntime } from "@/lib/google/server";
import { googleFailure } from "@/lib/google/errors";
import { executeGoogleRest } from "@/lib/google/execute";
import { readManagedGoogleConnection } from "@/db/repositories/google-managed";
import { saveGoogleStorageObservation } from "@/db/repositories/google-observations";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const target = z.object({ connectionId: recordId, generation: version }).strict().parse(await readBoundedJson(request, 2048));
    const current = await readManagedGoogleConnection(env.DB, access.owner);
    if (current === null || current.connectionId !== target.connectionId || current.generation !== target.generation) throw googleFailure("google_connection_unavailable", "storage-target");
    const settings = googleApiServerSettings(access.owner); const id: string = materialRequestKey(request.headers);
    const result = await executeGoogleRest(env.DB, access.owner, settings.execution, { method: "drive.about.get" }, { id, role: "account", storageUpperBytes: 0, selection:null,context:null}, googleExecutionRuntime());
    const after = await readManagedGoogleConnection(env.DB, access.owner);
    if (after === null || after.connectionId !== target.connectionId || after.generation !== target.generation) throw googleFailure("google_connection_unavailable", "storage-result");
    await saveGoogleStorageObservation(env.DB, access.owner, after, result.attemptId, settings.execution.project.projectId, result.data, Date.now());
    return privateJson({ status: "verified" }, 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
