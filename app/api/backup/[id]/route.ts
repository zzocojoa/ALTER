import { env } from "cloudflare:workers";
import { readBackupRun, cancelBackup } from "@/db/repositories/backup";
import { materialMutationAccess, materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { backupErrorResponse } from "@/lib/backup/server";

type Context = Readonly<{ params: Promise<{ id: string }> }>;
export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection) return access.rejection;
  try { return privateJson(await readBackupRun(env.DB, access.owner, (await context.params).id), 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
export async function DELETE(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection) return access.rejection;
  try { return privateJson(await cancelBackup(env.DB, access.owner, (await context.params).id), 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
