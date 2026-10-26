import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId, version } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleApiServerSettings, googleErrorResponse, googleExecutionRuntime } from "@/lib/google/server";
import { googleAcceptanceStep, runGoogleAcceptance } from "@/lib/google/acceptance";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  if (env.ALTER_GOOGLE_ACCEPTANCE_ENABLED !== "task14-fixed-v1") return privateJson({ error: "google_acceptance_disabled" }, 403);
  try {
    const target = z.object({ connectionId: recordId, generation: version, step: googleAcceptanceStep }).strict().parse(await readBoundedJson(request, 2048));
    const settings = googleApiServerSettings(access.owner);
    return privateJson(await runGoogleAcceptance(env.DB, access.owner, settings.execution, googleExecutionRuntime(), target), 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
