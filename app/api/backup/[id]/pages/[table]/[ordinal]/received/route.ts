import { env } from "cloudflare:workers";
import { acknowledgeBackupPage } from "@/db/repositories/backup-completion";
import { backupTable } from "@/lib/backup/contracts";
import type { BackupTableName } from "@/lib/backup/catalog";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { backupErrorResponse, backupOrdinal, readBackupAcknowledgement } from "@/lib/backup/server";
import { privateJson } from "@/lib/owner-access";

type Context = Readonly<{ params: Promise<{ id: string; table: string; ordinal: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try { const params = await context.params; const receipt = await readBackupAcknowledgement(request); await acknowledgeBackupPage(env.DB, access.owner, params.id, backupTable(params.table).name as BackupTableName, backupOrdinal(params.ordinal), receipt.sha256, receipt.bytes, Date.now()); return privateJson({ received: true }, 200); }
  catch (error: unknown) { return backupErrorResponse(error); }
}
