import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialOwnerAccess } from "@/lib/materials/server-access";
import { getMaterialTransfer } from "@/db/repositories/material-transfers";

export type MaterialUploadContext = Readonly<{ params: Promise<{ id: string }> }>;
export async function GET(_request: Request, context: MaterialUploadContext): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) return access.rejection;
  try {
    const { DB } = requireStorageBindings(env);
    const { id } = await context.params;
    const transfer = await getMaterialTransfer(DB, access.owner, id);
    return privateJson({ id: transfer.id, materialId: transfer.materialId, version: transfer.version, state: transfer.snapshot.state, metadata: transfer.metadata, failureCode: transfer.snapshot.failureCode }, 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
