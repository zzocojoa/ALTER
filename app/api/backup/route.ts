import { env } from "cloudflare:workers";
import { z } from "zod";
import hosting from "@/.openai/hosting.json";
import { startBackup } from "@/db/repositories/backup";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { backupErrorResponse } from "@/lib/backup/server";

export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection) return access.rejection;
  try {
    const input = z.object({ id: recordId }).strict().parse(await readBoundedJson(request, 1024));
    return privateJson(await startBackup(env.DB, access.owner, input.id, hosting.project_id, Date.now()), 200);
  } catch (error: unknown) { return backupErrorResponse(error); }
}
