import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, parseMaterialStart, readMaterialJson } from "@/lib/materials/request";
import { startMaterialTransfer } from "@/lib/materials/start";

export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  try {
    const key: string = materialRequestKey(request.headers);
    const input = parseMaterialStart(await readMaterialJson(request));
    const { DB } = requireStorageBindings(env);
    const transfer = await startMaterialTransfer(DB, access.owner, key, input, Date.now());
    return privateJson({ id: transfer.id, materialId: transfer.materialId, version: transfer.version, state: transfer.snapshot.state }, 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
