import compiled from "../../lib/materials/pdf-wasm/validator.wasm";
import { probePdfContent } from "../../lib/materials/pdf-probe-storage";
import { validateMaterialMetadata } from "../../lib/materials/policy";
import type { MaterialFailure } from "../../lib/materials/policy";

async function fetch(request: Request, environment: Readonly<{ BUCKET: R2Bucket }>): Promise<Response> {
  try {
    const metadata = validateMaterialMetadata({ title: "PDF 환경 검증", edition: "", role: "reference", kind: "pdf", filename: "fixture.pdf", mime: "application/pdf", bytes: Number(request.headers.get("x-fixture-bytes")), sha256: request.headers.get("x-fixture-sha256") });
    return Response.json(await probePdfContent(request, environment.BUCKET, metadata, compiled));
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") { const failure: MaterialFailure = error as MaterialFailure; return Response.json({ code: failure.code, field: failure.field }, { status: failure.status }); }
    throw error;
  }
}
const worker = { fetch };
export default worker;
