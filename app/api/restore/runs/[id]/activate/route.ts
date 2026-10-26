import { env } from "cloudflare:workers";
import { activateRestore } from "@/db/repositories/restore-activation";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { recordId } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request, context: Readonly<{ params: Promise<{ id: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const id: string = recordId.parse((await context.params).id);
    return privateJson(await activateRestore(env.DB, env.BUCKET, access.context, access.owner, id, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
