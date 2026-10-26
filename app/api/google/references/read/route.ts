import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey,readBoundedJson } from "@/lib/materials/request";
import { googleApiServerSettings,googleErrorResponse,googleExecutionRuntime } from "@/lib/google/server";
import { googleFileId } from "@/lib/google/resources";
import { downloadGoogleReference } from "@/lib/google-reference/download";
import { readGoogleReferenceRead } from "@/db/repositories/google-references";
import { privateJson } from "@/lib/owner-access";
export const dynamic="force-dynamic";
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection)return access.rejection;
  try {
    const input=z.object({fileId:googleFileId}).strict().parse(await readBoundedJson(request,2048));const id=materialRequestKey(request.headers);
    const result=await downloadGoogleReference(env.DB,access.owner,googleApiServerSettings(access.owner).execution,id,input.fileId,googleExecutionRuntime());
    return new Response(result.body,{headers:{"content-type":result.mime,"cache-control":"private, no-store","x-content-type-options":"nosniff","x-alter-reference-read":id}});
  }catch(error:unknown){return googleErrorResponse(error);}
}
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection)return access.rejection;
  try{return privateJson(await readGoogleReferenceRead(env.DB,access.owner,new URL(request.url).searchParams.get("id")??""),200);}catch(error:unknown){return googleErrorResponse(error);}
}
