import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { pngProbeMetadata } from "@/lib/materials/png-probe";
import { validatePngContent } from "@/lib/materials/png-content";
import { materialFailure } from "@/lib/materials/policy";
import type { MaterialFailure } from "@/lib/materials/policy";

/** 정해진 합성 검증 파일만 처리하며 자료나 저장소 상태를 변경하지 않습니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  try {
    const metadata = pngProbeMetadata(request);
    if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
    return privateJson(await validatePngContent(request.body, metadata, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)])), 200);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") {
      const failure: MaterialFailure = error as MaterialFailure;
      return privateJson({ error: failure.code, field: failure.field }, failure.status);
    }
    throw error;
  }
}
