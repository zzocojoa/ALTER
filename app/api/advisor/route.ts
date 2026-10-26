import { env } from "cloudflare:workers";
import { materialMutationAccess, materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { advisorAction } from "@/lib/advisor/request";
import { advisorConfiguration, advisorErrorResponse, advisorRuntime } from "@/lib/advisor/server";
import { dispatchAdvisor, processAdvisorAi } from "@/lib/advisor/ai";
import { beginStoredAdvisorAi, confirmAdvisorPlan, editStoredAdvisorPlan, getAdvisor, listAdvisors, startAdvisor, submitAdvisorAnswer } from "@/db/repositories/advisor";
import { domainFailure } from "@/lib/domain/contracts";

export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try {
    const id: string | null = new URL(request.url).searchParams.get("id");
    return privateJson(id ? { session: await getAdvisor(env.DB, access.owner, id) } : { sessions: await listAdvisors(env.DB, access.owner) }, 200);
  } catch (error: unknown) { return advisorErrorResponse(error); }
}
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const input = advisorAction.parse(await readBoundedJson(request, 65536));
    const cmd = { owner: access.owner, expectedVersion: input.expectedVersion, requestKey: materialRequestKey(request.headers) };
    if (input.action === "start") await startAdvisor(env.DB, cmd, input.id, input.conditions);
    else if (input.action === "answer") await submitAdvisorAnswer(env.DB, cmd, input.id, input.answer);
    else if (input.action === "edit") await editStoredAdvisorPlan(env.DB, cmd, input.id, input.proposal);
    else if (input.action === "confirm") await confirmAdvisorPlan(env.DB, cmd, input.id, input.choices);
    else {
      if (input.action === "generate") await beginStoredAdvisorAi(env.DB, cmd, input.id);
      const state = await getAdvisor(env.DB, access.owner, input.id);
      if (input.action === "recover" && !state.pending && state.version !== input.expectedVersion) throw domainFailure("version_conflict", "advisor.recover.version", null);
      if (state.pending) {
        const config = advisorConfiguration();
        await processAdvisorAi(await advisorRuntime(config, state), access.owner, input.id, config.pricing, dispatchAdvisor, request.signal);
      }
    }
    return privateJson({ session: await getAdvisor(env.DB, access.owner, input.id) }, 200);
  } catch (error: unknown) { return advisorErrorResponse(error); }
}
