import { env } from "cloudflare:workers";
import { receiveRestorePage } from "@/db/repositories/restore-receiving";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { backupPagePath, backupPolicy, backupTable } from "@/lib/backup/contracts";
import type { BackupTableName } from "@/lib/backup/catalog";
import { backupOrdinal } from "@/lib/backup/server";
import { readBoundedJsonDocument } from "@/lib/materials/request";
import { recordId } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";

export async function PUT(request: Request, context: Readonly<{ params: Promise<{ id: string; table: string; ordinal: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const params = await context.params; const id: string = recordId.parse(params.id); const path: string = backupPagePath(backupTable(params.table).name as BackupTableName, backupOrdinal(params.ordinal));
    const document = await readBoundedJsonDocument(request, backupPolicy.maximumPageBytes);
    return privateJson(await receiveRestorePage(env.DB, env.BUCKET, access.context, access.owner, id, path, document.text, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
