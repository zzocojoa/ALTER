import { env } from "cloudflare:workers";
import { receiveRestoreManifest } from "@/db/repositories/restore-receiving";
import { restoreMutationAccess, restoreErrorResponse } from "@/lib/backup/restore-server";
import { restoreAuthorityFailure } from "@/lib/backup/restore-authority";
import { backupPolicy } from "@/lib/backup/contracts";
import { readBoundedJsonDocument } from "@/lib/materials/request";
import { recordId } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";

export async function PUT(request: Request, context: Readonly<{ params: Promise<{ id: string }> }>): Promise<Response> {
  try { const access = await restoreMutationAccess(request); if (access.rejection) return access.rejection;
    if (access.configuration.role !== "restore-test") throw restoreAuthorityFailure("unsafe-target", "server-role");
    const id: string = recordId.parse((await context.params).id);
    const document = await readBoundedJsonDocument(request, backupPolicy.maximumManifestBytes);
    return privateJson(await receiveRestoreManifest(env.DB, env.BUCKET, access.context, access.owner, id, document.text, Date.now()), 200);
  } catch (error: unknown) { return restoreErrorResponse(error); }
}
