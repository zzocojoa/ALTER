import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { prepareGoogleReportWorkflow,readGoogleReportView } from "@/db/repositories/google-report-workflow";
import { externalErrorResponse } from "@/lib/external/server-error";
export const dynamic="force-dynamic";
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection)return access.rejection;
  try{return privateJson(await readGoogleReportView(env.DB,env.BUCKET,access.owner,recordId.parse(new URL(request.url).searchParams.get("versionId"))),200);}catch(error:unknown){return externalErrorResponse(env.DB,access.owner,error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection)return access.rejection;
  try{const input=z.object({versionId:recordId}).strict().parse(await readBoundedJson(request,2048));return privateJson(await prepareGoogleReportWorkflow(env.DB,env.BUCKET,access.owner,input.versionId,Date.now()),200);}catch(error:unknown){return externalErrorResponse(env.DB,access.owner,error);}
}
