import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialOwnerAccess } from "@/lib/materials/server-access";
import { readMaterialLibrary } from "@/lib/materials/library";

export async function GET(request: Request): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) return access.rejection;
  try { const { DB } = requireStorageBindings(env); return privateJson(await readMaterialLibrary(DB, access.owner, new URL(request.url).searchParams.get("after")), 200); }
  catch (error: unknown) { return materialErrorResponse(error); }
}
