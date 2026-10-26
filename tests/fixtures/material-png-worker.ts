import { validatePngContent } from "../../lib/materials/png-content";
import { materialFailure, validateMaterialMetadata } from "../../lib/materials/policy";
import type { MaterialFailure } from "../../lib/materials/policy";

async function fetch(request: Request): Promise<Response> {
  try {
    const metadata = validateMaterialMetadata({ title: "PNG 환경 검증", edition: "", role: "reference", kind: "image", filename: "fixture.png", mime: "image/png", bytes: Number(request.headers.get("x-fixture-bytes")), sha256: request.headers.get("x-fixture-sha256") });
    if (request.body === null) throw materialFailure("material_body_length_invalid", "body", 400);
    return Response.json(await validatePngContent(request.body, metadata, request.signal));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") {
      const failure: MaterialFailure = error as MaterialFailure;
      return Response.json({ code: failure.code, field: failure.field }, { status: failure.status });
    }
    console.error(JSON.stringify({ event: "png_fixture_failed", name: error instanceof Error ? error.name : "unknown", message: error instanceof Error ? error.message : String(error), cause: error instanceof Error && error.cause instanceof Error ? { name: error.cause.name, message: error.cause.message } : null }));
    throw error;
  }
}
const worker = { fetch };
export default worker;
