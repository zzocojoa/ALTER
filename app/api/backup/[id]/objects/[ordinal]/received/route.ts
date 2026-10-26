import { env } from "cloudflare:workers";
import { acknowledgeBackupObject } from "@/db/repositories/backup-objects";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { backupErrorResponse, backupOrdinal, readBackupAcknowledgement } from "@/lib/backup/server";
import { privateJson } from "@/lib/owner-access";

type Context = Readonly<{ params: Promise<{ id: string; ordinal: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try { const params = await context.params; const receipt = await readBackupAcknowledgement(request); await acknowledgeBackupObject(env.DB, access.owner, params.id, backupOrdinal(params.ordinal), receipt.sha256, receipt.bytes, Date.now()); return privateJson({ received: true }, 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
