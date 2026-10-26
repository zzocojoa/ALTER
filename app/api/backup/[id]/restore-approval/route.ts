import { env } from "cloudflare:workers";
import { approveBackupRestore } from "@/db/repositories/restore-approval";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure, restoreChallenge } from "@/lib/backup/restore-authority";
import { importRestoreSigningKey } from "@/lib/backup/restore-configuration";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request, route: Readonly<{ params: Promise<{ id: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "source") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const challenge = restoreChallenge.parse(await readBoundedJson(request, 4096));
    return privateJson(await approveBackupRestore(env.DB, env.BUCKET, access.context, access.owner, await importRestoreSigningKey(env.ALTER_RESTORE_SIGNING_KEY), challenge, (await route.params).id, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
