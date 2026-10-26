import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { textProbeMetadata } from "@/lib/materials/text-probe";
import { validateTextContent } from "@/lib/materials/text-content";
import { materialFailure } from "@/lib/materials/policy";
import type { MaterialFailure } from "@/lib/materials/policy";

/** 소유자 전용 고정 UTF-8 진단이며 저장이나 AI 호출을 하지 않습니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  try {
    const metadata = textProbeMetadata(request);
    if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
    return privateJson(await validateTextContent(request.body, metadata, AbortSignal.any([request.signal, AbortSignal.timeout(20000)])), 200);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") { const failure: MaterialFailure = error as MaterialFailure; return privateJson({ error: failure.code, field: failure.field }, failure.status); }
    throw error;
  }
}
