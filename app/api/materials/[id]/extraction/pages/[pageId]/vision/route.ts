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
import { materialRequestKey } from "@/lib/materials/request";
import { requireExtractionImage } from "@/lib/extraction/server";
import { preparedPageImage } from "@/lib/extraction/image";
import { dispatchPageVision } from "@/lib/extraction/vision-service";
import { pageVisionRuntime } from "@/lib/extraction/vision-runtime";
import { requireConfiguredKey } from "@/lib/ai/configuration";

type Context = Readonly<{ params: Promise<{ id: string; pageId: string }> }>;
const inputSchema = z.object({ selectionRevision: z.number().int().positive(), filePage: z.number().int().positive(), expectedVersion: z.number().int().positive(), image: preparedPageImage, comparedWithOriginal: z.literal(true) }).strict();
export async function POST(request: Request, context: Context): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection !== null) return access.rejection;
  try {
    const { DB, BUCKET } = requireStorageBindings(env); const { id, pageId } = await context.params;
    const input = inputSchema.parse(await readBoundedJson(request, 3 * 1024 * 1024));
    const proof = await requireExtractionPage(DB, BUCKET, access.owner, id, input.selectionRevision, input.filePage);
    const image = await requireExtractionImage(proof, input.image, request.signal);
    const page = await getExtractionPage(DB, access.owner, pageId);
    const configuration = requireAiConfiguration(env.ALTER_AI_CONFIGURATION);
    if (!env.OPENAI_API_KEY) throw Object.assign(new Error("API 키가 없습니다."), { code: "ai_key_required" });
    await requireConfiguredKey(env.OPENAI_API_KEY, configuration.credentialFingerprint);
    const runtime = await pageVisionRuntime(configuration, proof, page, image, request.signal);
    const progress = await dispatchPageVision(runtime, configuration, proof, page, image, { owner: access.owner, expectedVersion: input.expectedVersion, requestKey: materialRequestKey(request.headers) }, request.signal);
    return privateJson(progress, progress.page.state === "running" || progress.page.state === "unknown" ? 202 : 200);
  } catch (error: unknown) { return visionErrorResponse(error); }
}
