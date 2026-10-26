import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { requireExtractionPage } from "@/lib/extraction/server";
import { z } from "zod";
import { getExtractionPage } from "@/db/repositories/extraction-pages";
import { setExtractionPrintedPage } from "@/db/repositories/extraction-confirmations";

const labelInput = z.object({ selectionRevision: z.number().int().positive(), filePage: z.number().int().positive(), expectedVersion: z.number().int().positive(), printedPage: z.string().trim().max(40).nullable() }).strict();
type Context = Readonly<{ params: Promise<{ id: string; pageId: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const { id, pageId } = await context.params;
    const input = labelInput.parse(await readBoundedJson(request, 16384));
    const proof = await requireExtractionPage(DB, BUCKET, access.owner, id, input.selectionRevision, input.filePage);
    const page = await getExtractionPage(DB, access.owner, pageId);
    const command = { owner: access.owner, requestKey: materialRequestKey(request.headers), expectedVersion: input.expectedVersion };
    const receipt = await setExtractionPrintedPage(DB, command, proof, page, input.printedPage);
    return privateJson({ receipt, page: await getExtractionPage(DB, access.owner, pageId) }, 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
