import compiled from "@/lib/materials/jpeg-wasm/decoder.wasm";
import { ownerRejection, privateJson } from "@/lib/owner-access";
import { mutationRejection } from "@/lib/request-security";
import { jpegProbeMetadata } from "@/lib/materials/jpeg-probe";
import { validateJpegContent } from "@/lib/materials/jpeg-content";
import { materialFailure } from "@/lib/materials/policy";
import type { MaterialFailure } from "@/lib/materials/policy";

/** 소유자만 고정된 합성 JPEG를 검사하며 R2·D1·AI는 호출하지 않습니다. */
export async function POST(request: Request): Promise<Response> {
  const rejection: Response | null = await ownerRejection();
  if (rejection !== null) return rejection;
  const originRejection: Response | null = mutationRejection(request.headers.get("origin"));
  if (originRejection !== null) return originRejection;
  try {
    const metadata = jpegProbeMetadata(request);
    if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
    return privateJson(await validateJpegContent(request.body, metadata, AbortSignal.any([request.signal, AbortSignal.timeout(20_000)]), compiled), 200);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") {
      const failure: MaterialFailure = error as MaterialFailure;
      return privateJson({ error: failure.code, field: failure.field }, failure.status);
    }
    throw error;
  }
}
