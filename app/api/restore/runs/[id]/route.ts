import { env } from "cloudflare:workers";
import { readRestoreRun } from "@/db/repositories/restore-run";
import { restoreOwnerAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { privateJson } from "@/lib/owner-access";

export async function GET(_request: Request, route: Readonly<{ params: Promise<{ id: string }> }>): Promise<Response> {
  try { const access = await restoreOwnerAccess(); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    return privateJson(await readRestoreRun(env.DB, env.BUCKET, access.context, access.owner, (await route.params).id), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
