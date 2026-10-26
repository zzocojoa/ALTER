import { env } from "cloudflare:workers";
import { finishBackupDatabase } from "@/db/repositories/backup";
import { backupErrorResponse } from "@/lib/backup/server";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";

type Context = Readonly<{ params: Promise<{ id: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection) return access.rejection;
  try { return privateJson(await finishBackupDatabase(env.DB, access.owner, (await context.params).id), 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
