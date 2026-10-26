import { requireGoogleReportWorkflowCurrent } from "@/db/repositories/google-report-workflow";
import { externalErrorResponse } from "@/lib/external/server-error";
import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { googleApiServerSettings,googleExecutionRuntime } from "@/lib/google/server";
import { googleExternalTransport } from "@/lib/external/google-adapter";
import { readExternalWorkflowView,resumeExternalWorkflow,recheckExternalWorkflowConflict } from "@/lib/external/resume";
export const dynamic="force-dynamic";
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try {return privateJson(await readExternalWorkflowView(env.DB,access.owner,recordId.parse(new URL(request.url).searchParams.get("id"))),200);}
  catch(error:unknown) {return externalErrorResponse(env.DB,access.owner,error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=z.object({id:recordId,action:z.literal("verify-conflict").optional()}).strict().parse(await readBoundedJson(request,2048));
    await requireGoogleReportWorkflowCurrent(env.DB,env.BUCKET,access.owner,input.id);
    const settings=googleApiServerSettings(access.owner);const base=googleExecutionRuntime();
    const runtime={...base,rest:{...base.rest,fetch:async(url:string,init:RequestInit):Promise<Response>=>{await requireGoogleReportWorkflowCurrent(env.DB,env.BUCKET,access.owner,input.id);return base.rest.fetch(url,init);}}};
    const execute=input.action==="verify-conflict"?recheckExternalWorkflowConflict:resumeExternalWorkflow;
    return privateJson(await execute(env.DB,access.owner,input.id,googleExternalTransport(env.DB,access.owner,settings.execution,runtime),{now:Date.now,id:()=>crypto.randomUUID(),jitter:Math.random,warn:entry=>console.warn(entry),requestBudgetMs:60_000}),200);
  } catch(error:unknown) {return externalErrorResponse(env.DB,access.owner,error);}
}
