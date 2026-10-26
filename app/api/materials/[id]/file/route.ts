import { recordMaterialExposure, requireMaterialVisibility } from "@/db/repositories/material-access";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialOwnerAccess } from "@/lib/materials/server-access";
import { getRegisteredMaterial, headMaterialFile, readMaterialFile } from "@/lib/materials/download";
import type { MaterialDisposition } from "@/lib/materials/download";

type MaterialFileContext = Readonly<{ params: Promise<{ id: string }> }>;
function disposition(request: Request): MaterialDisposition { return z.enum(["inline", "attachment"]).parse(new URL(request.url).searchParams.get("disposition") ?? "inline"); }

export async function GET(request: Request, context: MaterialFileContext): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env);
    const transfer = await getRegisteredMaterial(DB, access.owner, (await context.params).id);
    await requireMaterialVisibility(DB, access.owner);
    const response: Response = await readMaterialFile(BUCKET, transfer, request, disposition(request));
    if (response.status === 200 || response.status === 206) {
      try { await recordMaterialExposure(DB, access.owner, transfer); }
      catch (error: unknown) { await response.body?.cancel(error); throw error; }
    }
    return response;
  } catch (error: unknown) { return materialErrorResponse(error); }
}

export async function HEAD(request: Request, context: MaterialFileContext): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection !== null) return new Response(null, { status: access.rejection.status, headers: access.rejection.headers });
  try {
    const { DB, BUCKET } = requireStorageBindings(env);
    const transfer = await getRegisteredMaterial(DB, access.owner, (await context.params).id);
    await requireMaterialVisibility(DB, access.owner);
    return await headMaterialFile(BUCKET, transfer, disposition(request));
  } catch (error: unknown) {
    const failure: Response = materialErrorResponse(error);
    return new Response(null, { status: failure.status, headers: failure.headers });
  }
}
