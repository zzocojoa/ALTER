import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialActionInput, readMaterialJson } from "@/lib/materials/request";
import { cleanupMaterialTransfer } from "@/lib/materials/recovery";
import type { MaterialUploadContext } from "../route";

export async function POST(request: Request, context: MaterialUploadContext): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  try {
    const input = materialActionInput.parse(await readMaterialJson(request));
    const { id } = await context.params;
    const { DB, BUCKET } = requireStorageBindings(env);
    return privateJson(await cleanupMaterialTransfer(DB, BUCKET, access.owner, id, input.expectedVersion, request.signal), 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
