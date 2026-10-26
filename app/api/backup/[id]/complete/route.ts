import { env } from "cloudflare:workers";
import { completeBackup, readCompletedBackup } from "@/db/repositories/backup-completion";
import { materialMutationAccess, materialOwnerAccess } from "@/lib/materials/server-access";
import { backupErrorResponse } from "@/lib/backup/server";
import { privateJson } from "@/lib/owner-access";

type Context = Readonly<{ params: Promise<{ id: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try { return privateJson(await completeBackup(env.DB, access.owner, (await context.params).id, Date.now()), 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try { return privateJson(await readCompletedBackup(env.DB, access.owner, (await context.params).id), 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
