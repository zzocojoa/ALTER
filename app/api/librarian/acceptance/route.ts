import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialOwnerAccess, materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { listConfirmedUnits } from "@/db/repositories/librarian-links";
import { getStudyScope, beginStoredScopeEvaluation } from "@/db/repositories/study-scopes";
import { readStorage } from "@/db/repositories/atomic";
import { ADVISOR_ACCEPTANCE_ID } from "@/lib/advisor/acceptance";
import { LIBRARIAN_ACCEPTANCE_ID, LIBRARIAN_ACCEPTANCE_IDS, LIBRARIAN_HELP_ACCEPTANCE_ID, LIBRARIAN_HELP_UNIT_TITLE } from "@/lib/librarian/acceptance-fixture";
import { requireLibrarianAcceptance, librarianAcceptanceDispatcher } from "@/lib/librarian/acceptance";
import { processLibrarianAi } from "@/lib/librarian/ai";
import { librarianConfiguration, librarianRuntime, librarianErrorResponse, readScopeView } from "@/lib/librarian/server";
import { domainFailure, version } from "@/lib/domain/contracts";
import { advisorRecordId } from "@/db/repositories/advisor";

export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try {
    const id = z.enum(LIBRARIAN_ACCEPTANCE_IDS).parse(new URL(request.url).searchParams.get("id") ?? LIBRARIAN_ACCEPTANCE_ID);
    const unit = (await listConfirmedUnits(env.DB, access.owner)).find((item): boolean => item.planId === ADVISOR_ACCEPTANCE_ID && (id === LIBRARIAN_HELP_ACCEPTANCE_ID ? item.title === LIBRARIAN_HELP_UNIT_TITLE && item.prerequisiteUnitIds.length === 1 : item.prerequisiteUnitIds.length === 0));
    if (!unit) throw domainFailure("reference_conflict", "librarian.acceptance-confirmed-advisor-required", null);
    const count = await readStorage("librarian.acceptance-state", () => env.DB.prepare("SELECT COUNT(*) AS n FROM study_scopes WHERE owner_id=? AND id=?").bind(access.owner.userId, id).first<number>("n"));
    return privateJson({ unit,view: count === 1 ? await readScopeView(access.owner, id) : null },200);
  } catch (error: unknown) { return librarianErrorResponse(error); }
}
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const input = z.object({ id: z.enum(LIBRARIAN_ACCEPTANCE_IDS).optional(), expectedVersion: version }).strict().parse(await readBoundedJson(request,1024));
    let state = await getStudyScope(env.DB, access.owner, input.id ?? LIBRARIAN_ACCEPTANCE_ID); requireLibrarianAcceptance(state);
    if (state.version !== input.expectedVersion) throw domainFailure("version_conflict", "librarian.acceptance-version", null);
    if (state.phase === "linked") { await beginStoredScopeEvaluation(env.DB, env.BUCKET, { owner: access.owner,requestKey: await advisorRecordId(`librarian-acceptance:${state.input.id}:${state.version}`),expectedVersion: state.version }, state.input.id); state = await getStudyScope(env.DB, access.owner, state.input.id); }
    if (state.pendingKey) { const config = librarianConfiguration(); await processLibrarianAi(await librarianRuntime(config,state),env.BUCKET,access.owner,state.input.id,config.pricing,librarianAcceptanceDispatcher(state),request.signal); }
    return privateJson(await readScopeView(access.owner,state.input.id),200);
  } catch (error: unknown) { return librarianErrorResponse(error); }
}
