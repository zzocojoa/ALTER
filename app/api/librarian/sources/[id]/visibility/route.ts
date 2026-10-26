import { env } from "cloudflare:workers";
import { recordId } from "@/lib/domain/contracts";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { resolveExtractionSource } from "@/lib/extraction/source-server";
import { getRegisteredMaterial } from "@/lib/materials/download";
import { recordMaterialExposure } from "@/db/repositories/material-access";
import { librarianErrorResponse } from "@/lib/librarian/server";

export async function GET(_request: Request, context: Readonly<{ params: Promise<{ id: string }> }>): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try {
    const id = recordId.parse((await context.params).id);
    const judgment = await resolveExtractionSource(env.DB, env.BUCKET, access.owner, id);
    if (!judgment.valid) return privateJson({ valid: false, reason: judgment.reason }, 409);
    await recordMaterialExposure(env.DB, access.owner, await getRegisteredMaterial(env.DB, access.owner, judgment.source.materialId));
    return privateJson({ valid: true }, 200);
  } catch (error: unknown) { return librarianErrorResponse(error); }
}
