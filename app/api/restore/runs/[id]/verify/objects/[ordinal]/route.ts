import { env } from "cloudflare:workers";
import { verifyRestoreOriginal } from "@/db/repositories/restore-verification";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { backupOrdinal } from "@/lib/backup/server";
import { recordId } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request, context: Readonly<{ params: Promise<{ id: string; ordinal: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const params = await context.params; const id: string = recordId.parse(params.id); const ordinal: number = backupOrdinal(params.ordinal);
    return privateJson(await verifyRestoreOriginal(env.DB, env.BUCKET, access.context, access.owner, id, ordinal, Date.now(), request.signal), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
