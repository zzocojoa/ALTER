import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson,materialRequestKey } from "@/lib/materials/request";
import { acknowledgeTutorHelp } from "@/db/repositories/tutor-help";
import { tutorErrorResponse } from "@/lib/tutor/server";
import { privateJson } from "@/lib/owner-access";
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {const input=z.object({id:recordId,helpId:recordId}).strict().parse(await readBoundedJson(request,2048));await acknowledgeTutorHelp(env.DB,{owner:access.owner,requestKey:materialRequestKey(request.headers),expectedVersion:1},input.id,input.helpId,Date.now());return privateJson({acknowledged:true},200);}catch(error:unknown){return tutorErrorResponse(error);}
}
