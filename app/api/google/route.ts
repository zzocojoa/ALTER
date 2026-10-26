import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { googleErrorResponse, readGoogleConnectionView } from "@/lib/google/server";
export const dynamic = "force-dynamic";
export async function GET(): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try { return privateJson(await readGoogleConnectionView(access.owner), 200); } catch (error: unknown) { return googleErrorResponse(error); }
}
