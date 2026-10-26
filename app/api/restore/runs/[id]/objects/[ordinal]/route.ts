import { env } from "cloudflare:workers";
import { receiveRestoreOriginal } from "@/db/repositories/restore-originals";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { restoreOriginalInput } from "@/lib/backup/restore-original";
import { backupOrdinal } from "@/lib/backup/server";
import { recordId } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";

export async function PUT(request: Request, context: Readonly<{ params: Promise<{ id: string; ordinal: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const params = await context.params; const query: URLSearchParams = new URL(request.url).searchParams;
    const input = restoreOriginalInput.parse({ ordinal: backupOrdinal(params.ordinal), uploadPage: backupOrdinal(query.get("uploadPage") ?? ""), transferPage: backupOrdinal(query.get("transferPage") ?? "") });
    return privateJson(await receiveRestoreOriginal(env.DB, env.BUCKET, access.context, access.owner, recordId.parse(params.id), input, request, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
