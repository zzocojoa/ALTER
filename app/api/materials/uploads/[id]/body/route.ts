import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialFailure } from "@/lib/materials/policy";
import { uploadMaterialBody } from "@/lib/materials/upload";
import type { MaterialUploadContext } from "../route";

export async function PUT(request: Request, context: MaterialUploadContext): Promise<Response> {
  const access = await materialMutationAccess(request);
  if (access.rejection !== null) return access.rejection;
  try {
    const version: string | null = request.headers.get("x-upload-version");
    if (version === null || !/^[1-9]\d*$/.test(version) || !Number.isSafeInteger(Number(version))) throw materialFailure("material_request_invalid", "x-upload-version", 400);
    const { id } = await context.params;
    const { DB, BUCKET } = requireStorageBindings(env);
    return privateJson(await uploadMaterialBody(DB, BUCKET, access.owner, id, Number(version), request), 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
