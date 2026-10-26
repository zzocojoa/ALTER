import { env } from "cloudflare:workers";
import { z } from "zod";
import { privateJson } from "@/lib/owner-access";
import { requireStorageBindings } from "@/lib/storage-bindings";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { requireExtractionPage } from "@/lib/extraction/server";
import { getExtractionPage } from "@/db/repositories/extraction-pages";
import { requireAiConfiguration } from "@/lib/ai/configuration";
import { visionErrorResponse } from "@/lib/extraction/vision-errors";
import { recoverPageVision } from "@/lib/extraction/vision-service";
import { pageRecoveryRuntime } from "@/lib/extraction/vision-runtime";

type Context = Readonly<{ params: Promise<{ id: string; pageId: string }> }>;
const inputSchema = z.object({ selectionRevision: z.number().int().positive(), filePage: z.number().int().positive() }).strict();
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const { id, pageId } = await context.params;
    const input = inputSchema.parse(await readBoundedJson(request, 16384));
    const proof = await requireExtractionPage(DB, BUCKET, access.owner, id, input.selectionRevision, input.filePage);
    const page = await getExtractionPage(DB, access.owner, pageId);
    const runtime = pageRecoveryRuntime(requireAiConfiguration(env.ALTER_AI_CONFIGURATION), proof, page);
    return privateJson(await recoverPageVision(runtime, proof, page, request.signal), 200);
  } catch (error: unknown) { return visionErrorResponse(error); }
}
