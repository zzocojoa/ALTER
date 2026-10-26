import { resultRequest } from "@/lib/results/contracts";
import { confirmSessionResult } from "@/db/repositories/result-confirmation";
import { materialRequestKey,readBoundedJson } from "@/lib/materials/request";
import { env } from "cloudflare:workers";
import { materialOwnerAccess,materialMutationAccess } from "@/lib/materials/server-access";
import { privateJson } from "@/lib/owner-access";
import { tutorErrorResponse } from "@/lib/tutor/server";
import { readResultSnapshot } from "@/db/repositories/result-draft";
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try {return privateJson((await readResultSnapshot(env.DB,access.owner,new URL(request.url).searchParams.get("id") ?? "")).draft,200);}catch(error:unknown){return tutorErrorResponse(error);}
}

export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {const input=resultRequest.parse(await readBoundedJson(request,8192));await confirmSessionResult(env.DB,{owner:access.owner,requestKey:materialRequestKey(request.headers),expectedVersion:input.expectedVersion},input,Date.now());return privateJson((await readResultSnapshot(env.DB,access.owner,input.id)).draft,200);}catch(error:unknown){return tutorErrorResponse(error);}
}
