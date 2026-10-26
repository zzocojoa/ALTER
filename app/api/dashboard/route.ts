import { env } from "cloudflare:workers";
import { readLearningDashboard } from "@/db/repositories/dashboard";
import { materialOwnerAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { tutorErrorResponse } from "@/lib/tutor/server";

export async function GET(): Promise<Response> {
  const access = await materialOwnerAccess();
  if (access.rejection) return access.rejection;
  try { return privateJson(await readLearningDashboard(env.DB, env.BUCKET, access.owner, Date.now()), 200); }
  catch (error: unknown) { return tutorErrorResponse(error); }
}
