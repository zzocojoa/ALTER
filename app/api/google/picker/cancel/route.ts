import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleErrorResponse } from "@/lib/google/server";
import { cancelGooglePickerLease } from "@/db/repositories/google-resources";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try { const input = z.object({ leaseId: recordId }).strict().parse(await readBoundedJson(request, 1024)); await cancelGooglePickerLease(env.DB, access.owner, input.leaseId); return privateJson({ status: "canceled" }, 200); }
  catch (error: unknown) { return googleErrorResponse(error); }
}
