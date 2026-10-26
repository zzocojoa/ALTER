import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { verifyMaterialInventory } from "@/lib/materials/inventory";

export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  try { const { DB, BUCKET } = requireStorageBindings(env); return privateJson(await verifyMaterialInventory(DB, BUCKET, access.owner, Date.now()), 200); }
  catch (error: unknown) { return materialErrorResponse(error); }
}
