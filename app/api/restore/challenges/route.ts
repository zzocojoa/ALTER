import { env } from "cloudflare:workers";
import { z } from "zod";
import { createRestoreChallenge } from "@/db/repositories/restore-run";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { recordId } from "@/lib/domain/contracts";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";

export async function POST(request: Request): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const input = z.object({ id: recordId }).strict().parse(await readBoundedJson(request, 1024)); const now: number = Date.now();
    return privateJson(await createRestoreChallenge(env.DB, env.BUCKET, access.context, access.owner, input.id, now, now + 900000), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
