import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { advisorRecordId, startAdvisor, getAdvisor, submitAdvisorAnswer, beginStoredAdvisorAi } from "@/db/repositories/advisor";
import { version, domainFailure } from "@/lib/domain/contracts";
import { ADVISOR_ACCEPTANCE_ID, ADVISOR_ACCEPTANCE_CONDITIONS, acceptanceAnswer, requireAdvisorAcceptance, advisorAcceptanceDispatcher } from "@/lib/advisor/acceptance";
import { advisorConfiguration, advisorRuntime, advisorErrorResponse } from "@/lib/advisor/server";
import { processAdvisorAi } from "@/lib/advisor/ai";

export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const input = z.discriminatedUnion("action", [z.object({ action: z.literal("start") }).strict(), z.object({ action: z.literal("advance"), expectedVersion: version }).strict()]).parse(await readBoundedJson(request, 1024));
    const id: string = ADVISOR_ACCEPTANCE_ID;
    if (input.action === "start") await startAdvisor(env.DB, { owner: access.owner, expectedVersion: 1, requestKey: id }, id, ADVISOR_ACCEPTANCE_CONDITIONS);
    else {
      let state = await getAdvisor(env.DB, access.owner, id); await requireAdvisorAcceptance(state);
      if (state.version !== input.expectedVersion) throw domainFailure("version_conflict", "advisor.acceptance.version", null);
      const cmd = { owner: access.owner, expectedVersion: state.version, requestKey: await advisorRecordId(`acceptance:${id}:${state.version}`) };
      if (state.question) await submitAdvisorAnswer(env.DB, cmd, id, acceptanceAnswer(state));
      else if (["diagnosis", "planning"].includes(state.phase)) {
        if (!state.pending) { await beginStoredAdvisorAi(env.DB, cmd, id); state = await getAdvisor(env.DB, access.owner, id); }
        const config = advisorConfiguration();
        await processAdvisorAi(await advisorRuntime(config, state), access.owner, id, config.pricing, advisorAcceptanceDispatcher(state), request.signal);
      }
    }
    return privateJson({ session: await getAdvisor(env.DB, access.owner, id) }, 200);
  } catch (error: unknown) { return advisorErrorResponse(error); }
}
