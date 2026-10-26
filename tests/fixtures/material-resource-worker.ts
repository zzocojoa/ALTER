import { probeMaterialResources } from "../../lib/materials/resource-probe";
import type { MaterialFailure } from "../../lib/materials/policy";

async function fetch(request: Request, env: Readonly<{ BUCKET: R2Bucket }>): Promise<Response> {
  try { return Response.json(await probeMaterialResources(request, env.BUCKET)); }
  catch (error: unknown) {
    if (error instanceof Error && error.name === "MaterialFailure") {
      const failure: MaterialFailure = error as MaterialFailure;
      return Response.json({ error: failure.code }, { status: failure.status });
    }
    throw error;
  }
}
const worker = { fetch };
export default worker;
