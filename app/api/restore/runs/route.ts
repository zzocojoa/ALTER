import { env } from "cloudflare:workers";
import { z } from "zod";
import { startRestoreRun } from "@/db/repositories/restore-run";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { importRestoreTrust } from "@/lib/backup/restore-configuration";
import { recordId } from "@/lib/domain/contracts";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const input = z.object({ id: recordId, challengeId: recordId, backupId: recordId, manifestSha256: z.string().regex(/^[a-f0-9]{64}$/), token: z.string().max(8192) }).strict().parse(await readBoundedJson(request, 10000));
    return privateJson(await startRestoreRun(env.DB, env.BUCKET, access.context, access.owner, await importRestoreTrust(access.configuration), input.token, input.id, input.challengeId, input.backupId, input.manifestSha256, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
