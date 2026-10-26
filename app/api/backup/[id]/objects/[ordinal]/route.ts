import { env } from "cloudflare:workers";
import { streamBackupObject } from "@/lib/backup/object-stream";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { backupErrorResponse, backupOrdinal } from "@/lib/backup/server";

type Context = Readonly<{ params: Promise<{ id: string; ordinal: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const params = await context.params;
    const result = await streamBackupObject(env.DB, env.BUCKET, access.owner, params.id, backupOrdinal(params.ordinal), request.signal);
    return new Response(result.body, { headers: { "Content-Type": "application/octet-stream", "Cache-Control": "private, no-store, no-transform", "Vary": "Cookie", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="${result.entry.path.split("/")[1]}"`, "X-Backup-Sha256": result.entry.sha256, "X-Backup-Bytes": String(result.entry.bytes) } });
  } catch (error: unknown) { return backupErrorResponse(error); }
}
