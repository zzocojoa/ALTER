import { env } from "cloudflare:workers";
import { z } from "zod";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { getRegisteredMaterial } from "@/lib/materials/download";
import { headMaterialObject } from "@/lib/materials/object";
import { materialErrorResponse, materialMutationAccess, materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readMaterialJson } from "@/lib/materials/request";
import { selectionInput } from "@/lib/extraction/selection";
import { getExtractionJob, saveExtractionSelection } from "@/db/repositories/extraction-jobs";
import { listExtractionPages } from "@/db/repositories/extraction-pages";
import { requireMaterialVisibility } from "@/db/repositories/material-access";

type Context = Readonly<{ params: Promise<{ id: string }> }>;
const selectInput = z.object({ expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), selection: selectionInput }).strict();
export async function GET(_request: Request, context: Context): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection !== null) return access.rejection;
  try { const { DB, BUCKET } = requireStorageBindings(env); const id: string = (await context.params).id; const transfer = await getRegisteredMaterial(DB, access.owner, id); await requireMaterialVisibility(DB, access.owner); await headMaterialObject(BUCKET, transfer); const job = await getExtractionJob(DB, access.owner, id); return privateJson({ job, pages: job === null ? [] : await listExtractionPages(DB, access.owner, id, job.revision) }, 200); }
  catch (error: unknown) { return materialErrorResponse(error); }
}
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const id: string = (await context.params).id;
    const input = selectInput.parse(await readMaterialJson(request));
    if (input.selection.materialId !== id) return privateJson({ error: "material_request_invalid", field: "materialId" }, 400);
    const transfer = await getRegisteredMaterial(DB, access.owner, id); await requireMaterialVisibility(DB, access.owner); await headMaterialObject(BUCKET, transfer);
    const receipt = await saveExtractionSelection(DB, { owner: access.owner, requestKey: materialRequestKey(request.headers), expectedVersion: input.expectedRevision }, transfer, input.selection);
    const job = await getExtractionJob(DB, access.owner, id);
    return privateJson({ receipt, job, pages: job === null ? [] : await listExtractionPages(DB, access.owner, id, job.revision) }, 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
