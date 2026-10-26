import { env } from "cloudflare:workers";
import { z } from "zod";
import { exportBackupPage } from "@/db/repositories/backup";
import { backupTable } from "@/lib/backup/contracts";
import type { BackupTableName } from "@/lib/backup/catalog";
import { backupErrorResponse } from "@/lib/backup/server";
import { materialMutationAccess } from "@/lib/materials/server-access";

type Context = Readonly<{ params: Promise<{ id: string; table: string; ordinal: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection) return access.rejection;
  try {
    const params = await context.params;
    const ordinal: number = Number(z.string().regex(/^(0|[1-9][0-9]{0,3})$/).parse(params.ordinal));
    const result = await exportBackupPage(env.DB, access.owner, params.id, backupTable(params.table).name as BackupTableName, ordinal);
    return new Response(result.json, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "vary": "Cookie", "x-content-type-options": "nosniff", "x-backup-sha256": result.entry.sha256, "x-backup-bytes": String(result.entry.bytes) } });
  } catch (error: unknown) { return backupErrorResponse(error); }
}
