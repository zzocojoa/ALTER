import { env } from "cloudflare:workers";
import { z } from "zod";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { requireExtractionPage } from "@/lib/extraction/server";
import { getExtractionPage } from "@/db/repositories/extraction-pages";
import { createExtractionSource } from "@/db/repositories/extraction-sources";
import { readStorage } from "@/db/repositories/atomic";
import { resolveExtractionSource } from "@/lib/extraction/source-server";

type Context = Readonly<{ params: Promise<{ id: string; pageId: string }> }>;
const inputSchema = z.object({ selectionRevision: z.number().int().positive(), filePage: z.number().int().positive(), expectedVersion: z.number().int().positive(), segmentId: z.string().regex(/^s[0-9]{1,4}$/) }).strict();
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const { id, pageId } = await context.params;
    const input = inputSchema.parse(await readBoundedJson(request, 16384));
    const proof = await requireExtractionPage(DB, BUCKET, access.owner, id, input.selectionRevision, input.filePage);
    const page = await getExtractionPage(DB, access.owner, pageId);
    await createExtractionSource(DB, { owner: access.owner, expectedVersion: input.expectedVersion, requestKey: materialRequestKey(request.headers) }, proof, page, input.segmentId);
    const sourceId = await readStorage("extraction.source.id", () => DB.prepare("SELECT source_id FROM extraction_sources WHERE owner_id=? AND result_id=? AND segment_id=?").bind(access.owner.userId, page.resultId, input.segmentId).first<string>("source_id"));
    if (sourceId === null) throw new Error("저장된 출처가 없습니다.");
    return privateJson(await resolveExtractionSource(DB, BUCKET, access.owner, sourceId), 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
