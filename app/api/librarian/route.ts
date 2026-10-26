import { env } from "cloudflare:workers";
import { materialMutationAccess, materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { librarianAction } from "@/lib/librarian/request";
import { librarianConfiguration, librarianErrorResponse, librarianRuntime, readLibrarianOverview, readScopeView } from "@/lib/librarian/server";
import { dispatchLibrarian, processLibrarianAi } from "@/lib/librarian/ai";
import { beginStoredScopeEvaluation, confirmStoredScope, createStudyScope, getStudyScope } from "@/db/repositories/study-scopes";
import { createMaterialLink } from "@/db/repositories/librarian-links";
import { domainFailure } from "@/lib/domain/contracts";

export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try { const params = new URL(request.url).searchParams; const id = params.get("id"); return privateJson(id ? await readScopeView(access.owner, id) : await readLibrarianOverview(access.owner, params.get("unit")), 200); }
  catch (error: unknown) { return librarianErrorResponse(error); }
}
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const input = librarianAction.parse(await readBoundedJson(request, 16384));
    const cmd = { owner: access.owner, expectedVersion: "expectedVersion" in input ? input.expectedVersion : 1, requestKey: materialRequestKey(request.headers) };
    if (input.action === "link") { await createMaterialLink(env.DB, env.BUCKET, cmd, input.link); return privateJson(await readLibrarianOverview(access.owner, input.link.unitId), 200); }
    if (input.action === "start") { await createStudyScope(env.DB, env.BUCKET, cmd, input.input); return privateJson(await readScopeView(access.owner, input.input.id), 200); }
    if (input.action === "confirm") await confirmStoredScope(env.DB, env.BUCKET, cmd, input.id, input.choices);
    else {
      if (input.action === "generate") await beginStoredScopeEvaluation(env.DB, env.BUCKET, cmd, input.id);
      const state = await getStudyScope(env.DB, access.owner, input.id);
      if (input.action === "recover" && !state.pendingKey && state.version !== input.expectedVersion) throw domainFailure("version_conflict", "librarian.recover-version", null);
      if (state.pendingKey) { const config = librarianConfiguration(); await processLibrarianAi(await librarianRuntime(config, state), env.BUCKET, access.owner, input.id, config.pricing, dispatchLibrarian, request.signal); }
    }
    return privateJson(await readScopeView(access.owner, input.id), 200);
  } catch (error: unknown) { return librarianErrorResponse(error); }
}
