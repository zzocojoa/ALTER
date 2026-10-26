import { env } from "cloudflare:workers";
import { verifyRestorePage } from "@/db/repositories/restore-verification";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { backupPagePath, backupTable } from "@/lib/backup/contracts";
import type { BackupTableName } from "@/lib/backup/catalog";
import { backupOrdinal } from "@/lib/backup/server";
import { recordId } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request, context: Readonly<{ params: Promise<{ id: string; table: string; ordinal: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const params = await context.params; const id: string = recordId.parse(params.id); const path: string = backupPagePath(backupTable(params.table).name as BackupTableName, backupOrdinal(params.ordinal));
    return privateJson(await verifyRestorePage(env.DB, env.BUCKET, access.context, access.owner, id, path, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
