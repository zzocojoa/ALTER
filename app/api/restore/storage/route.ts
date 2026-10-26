import { env } from "cloudflare:workers";
import { registerRestoreStorage } from "@/db/repositories/restore-storage";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    return privateJson(await registerRestoreStorage(env.DB, env.BUCKET, access.context, access.owner, access.configuration.source, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
