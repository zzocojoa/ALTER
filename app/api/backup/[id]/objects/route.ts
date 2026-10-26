import { env } from "cloudflare:workers";
import { listBackupObjects } from "@/db/repositories/backup-objects";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { backupErrorResponse, backupOrdinal } from "@/lib/backup/server";

type Context = Readonly<{ params: Promise<{ id: string }> }>;
export async function GET(request: Request, context: Context): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try { return privateJson(await listBackupObjects(env.DB, access.owner, (await context.params).id, backupOrdinal(new URL(request.url).searchParams.get("offset") ?? "0")), 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
