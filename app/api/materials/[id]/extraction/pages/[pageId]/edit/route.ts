import { z } from "zod";
import { env } from "cloudflare:workers";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialErrorResponse, materialMutationAccess } from "@/lib/materials/server-access";
import { materialRequestKey, readBoundedJson } from "@/lib/materials/request";
import { requireExtractionPage } from "@/lib/extraction/server";
import { getExtractionPage, saveExtractionCorrection, saveInitialTranscription } from "@/db/repositories/extraction-pages";
import { correctionInput } from "@/lib/extraction/confirmation";

import { transcriptionInput } from "@/lib/extraction/transcription";

type Context = Readonly<{ params: Promise<{ id: string; pageId: string }> }>;
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const { id, pageId } = await context.params;
    const input = z.union([correctionInput, transcriptionInput]).parse(await readBoundedJson(request, 524288));
    const proof = await requireExtractionPage(DB, BUCKET, access.owner, id, input.selectionRevision, input.filePage);
    const page = await getExtractionPage(DB, access.owner, pageId);
    const command = { owner: access.owner, requestKey: materialRequestKey(request.headers), expectedVersion: input.expectedVersion };
    const receipt = "intent" in input ? await saveInitialTranscription(DB, command, proof, page, input) : await saveExtractionCorrection(DB, command, proof, page, input);
    return privateJson({ receipt, page: await getExtractionPage(DB, access.owner, pageId) }, 200);
  } catch (error: unknown) { return materialErrorResponse(error); }
}
