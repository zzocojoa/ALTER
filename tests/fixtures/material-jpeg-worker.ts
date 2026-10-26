import compiled from "../../lib/materials/jpeg-wasm/decoder.wasm";
import { validateJpegContent } from "../../lib/materials/jpeg-content";
import { materialFailure, validateMaterialMetadata } from "../../lib/materials/policy";
import type { MaterialFailure } from "../../lib/materials/policy";

async function fetch(request: Request): Promise<Response> {
  try {
    const metadata = validateMaterialMetadata({ title: "JPEG 환경 검증", edition: "", role: "reference", kind: "image", filename: "fixture.jpg", mime: "image/jpeg", bytes: Number(request.headers.get("x-fixture-bytes")), sha256: request.headers.get("x-fixture-sha256") });
    if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
    return Response.json(await validateJpegContent(request.body, metadata, request.signal, compiled));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") {
      const failure: MaterialFailure = error as MaterialFailure;
      return Response.json({ code: failure.code, field: failure.field }, { status: failure.status });
    }
    throw error;
  }
}
const worker = { fetch };
export default worker;
