import { env } from "cloudflare:workers";
import { readUsageDashboard } from "@/db/repositories/dashboard-usage";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { tutorErrorResponse } from "@/lib/tutor/server";

export async function GET(): Promise<Response> {
  const access = await materialOwnerAccess(); if (access.rejection) return access.rejection;
  try { return privateJson(await readUsageDashboard(env.DB, access.owner, env.ALTER_AI_CONFIGURATION, Date.now()), 200); }
  catch (error: unknown) { return tutorErrorResponse(error); }
}
