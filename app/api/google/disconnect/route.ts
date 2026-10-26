import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { recordId, version } from "@/lib/domain/contracts";
import { privateJson } from "@/lib/owner-access";
import type { GoogleTokenKeyring } from "@/lib/google/token-crypto";
import { requireGoogleTokenKeyring } from "@/lib/google/token-crypto";
import { googleErrorResponse, googleOAuthRuntime } from "@/lib/google/server";
import { disconnectGoogle } from "@/lib/google/disconnect";
export const dynamic = "force-dynamic";
export async function POST(request: Request): Promise<Response> {
  const access = await materialMutationAccess(request); if (access.rejection) return access.rejection;
  try {
    const target = z.object({ connectionId: recordId, generation: version }).strict().parse(await readBoundedJson(request, 2048));
    let keyring: GoogleTokenKeyring | null = null;
    try { keyring = requireGoogleTokenKeyring(env.GOOGLE_TOKEN_ENCRYPTION_KEY ?? ""); }
    catch (error: unknown) { if (!(error instanceof Error) || error.name !== "GoogleFailure") throw error; }
    return privateJson(await disconnectGoogle(env.DB, access.owner, keyring, googleOAuthRuntime(), target), 200);
  } catch (error: unknown) { return googleErrorResponse(error); }
}
