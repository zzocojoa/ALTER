import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialOwnerAccess,materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleErrorResponse } from "@/lib/google/server";
import { googleStudySchedule } from "@/lib/google-calendar/contract";
import { createGoogleCalendarSetup,createGoogleSchedule,readGoogleCalendarSetup,readGoogleSchedule } from "@/db/repositories/google-calendar";
export const dynamic="force-dynamic";
export async function GET():Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try{const [setup,study,review]=await Promise.all([readGoogleCalendarSetup(env.DB,access.owner),readGoogleSchedule(env.DB,access.owner,"study"),readGoogleSchedule(env.DB,access.owner,"weekly-review")]);return privateJson({setup,study,review},200);}catch(error:unknown){return googleErrorResponse(error);}
}
const command=z.discriminatedUnion("action",[z.object({action:z.literal("prepare"),requestKey:z.string().uuid()}).strict(),z.object({action:z.literal("schedule"),requestKey:z.string().uuid(),schedule:googleStudySchedule}).strict()]);
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try{const input=command.parse(await readBoundedJson(request,4096));const result=input.action==="prepare"?await createGoogleCalendarSetup(env.DB,access.owner,input.requestKey,Date.now()):await createGoogleSchedule(env.DB,access.owner,input.requestKey,input.schedule,Date.now());return privateJson(result,200);}catch(error:unknown){return googleErrorResponse(error);}
}
