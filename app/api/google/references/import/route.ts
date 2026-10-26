import { env } from "cloudflare:workers";
import { z } from "zod";
import { recordId } from "@/lib/domain/contracts";
import { materialMutationAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { googleErrorResponse } from "@/lib/google/server";
import { startGoogleReferenceImport } from "@/db/repositories/google-references";
import { privateJson } from "@/lib/owner-access";
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection)return access.rejection;
  try {
    const input=z.object({readId:recordId,courseId:recordId}).strict().parse(await readBoundedJson(request,2048));
    const transfer=await startGoogleReferenceImport(env.DB,access.owner,input.readId,input.courseId,Date.now());
    return privateJson({id:transfer.id,materialId:transfer.materialId,version:transfer.version,state:transfer.snapshot.state,metadata:transfer.metadata},200);
  }catch(error:unknown){return googleErrorResponse(error);}
}
