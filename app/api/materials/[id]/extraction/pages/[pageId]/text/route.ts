import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { extractionTextInput, requireExtractionPage, requireExtractionText } from "@/lib/extraction/server";
import { getExtractionPage, saveTextExtraction } from "@/db/repositories/extraction-pages";

type Context = Readonly<{ params: Promise<{ id: string; pageId: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const { id, pageId } = await context.params;
    const input = extractionTextInput.parse(await readBoundedJson(request, 1048576));
    const proof = await requireExtractionPage(DB, BUCKET, access.owner, id, input.selectionRevision, input.filePage);
    const page = await getExtractionPage(DB, access.owner, pageId);
    const result = requireExtractionText(proof, input.result);
    const receipt = await saveTextExtraction(DB, { owner: access.owner, requestKey: materialRequestKey(request.headers), expectedVersion: input.expectedVersion }, proof, page, result);
    return privateJson({ receipt, page: await getExtractionPage(DB, access.owner, pageId) }, 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
