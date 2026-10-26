import { createEditorRevisit } from "@/db/repositories/editor-revisit";
import { cancelEditorEvaluation,finishEditorSession } from "@/lib/editor/review";
import { beginStoredEditorReview } from "@/db/repositories/editor-review";
import { env } from "cloudflare:workers";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { materialRequestKey,readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { domainFailure } from "@/lib/domain/contracts";
import { editorAction } from "@/lib/editor/actions";
import { editorRequest } from "@/lib/editor/request";
import { readEditorOverview,readEditorView } from "@/lib/editor/server";
import { createEditor,submitStoredEditorDraft } from "@/db/repositories/editor";
import { saveStoredEditorRevisionDraft,submitStoredEditorRevision } from "@/db/repositories/editor-revision";
import { beginStoredEditorFeedback } from "@/db/repositories/editor-feedback";
import { saveStoredTutorDraft,emptyTutorPlan,dispatchTutorAction } from "@/db/repositories/tutor-actions";
import { getTutor,previousTutor,saveTutorTransition } from "@/db/repositories/tutor";
import { createTutorRuntime,tutorConfiguration } from "@/lib/tutor/runtime";
import { processTutorAi,dispatchTutor,beginStoredTutorAi } from "@/lib/tutor/ai";
import { tutorErrorResponse } from "@/lib/tutor/server";
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try {const id=new URL(request.url).searchParams.get("id");return privateJson(id ? await readEditorView(access.owner,id) : await readEditorOverview(access.owner),200);}catch(error:unknown){return tutorErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=editorAction.parse(await readBoundedJson(request,262144));const cmd={owner:access.owner,requestKey:materialRequestKey(request.headers),expectedVersion:"expectedVersion" in input ? input.expectedVersion : 1};
    if(input.action!=="start" && input.action!=="revisit" && !(await getTutor(env.DB,access.owner,input.id)).editor) throw domainFailure("reference_conflict","editor.session-required",null);
    switch(input.action) {
      case "revisit":await createEditorRevisit(env.DB,env.BUCKET,cmd,input,Date.now());break;
      case "start":await createEditor(env.DB,env.BUCKET,cmd,input,Date.now());break;
      case "finish":{finishEditorSession(await previousTutor(env.DB,cmd,input.id));await dispatchTutorAction(env.DB,env.BUCKET,cmd,input,Date.now());break;}
      case "draft":await saveStoredTutorDraft(env.DB,env.BUCKET,cmd,input.id,input.draft);break;
      case "submit":await submitStoredEditorDraft(env.DB,env.BUCKET,cmd,input.id,input.answerId,input.draft,Date.now());break;
      case "revision-draft":await saveStoredEditorRevisionDraft(env.DB,env.BUCKET,cmd,input.id,input.draft,input.reason);break;
      case "revision-submit":await submitStoredEditorRevision(env.DB,env.BUCKET,cmd,input.id,{answerId:input.answerId,attemptId:input.attemptId,draft:input.draft,reason:input.reason,submittedAt:Date.now()});break;
      case "cancel":{const state=await previousTutor(env.DB,cmd,input.id);await saveTutorTransition(env.DB,cmd,cancelEditorEvaluation(state),"editor-cancel",{id:input.id},emptyTutorPlan);break;}
      case "feedback":case "review":case "variation":case "recover":{
        if(input.action==="feedback") await beginStoredEditorFeedback(env.DB,env.BUCKET,cmd,input.id);
        if(input.action==="variation") await beginStoredTutorAi(env.DB,env.BUCKET,cmd,input.id,"variation");
        if(input.action==="review") await beginStoredEditorReview(env.DB,env.BUCKET,cmd,input.id);
        const state=await getTutor(env.DB,access.owner,input.id);if(input.action==="recover" && state.version!==input.expectedVersion) throw domainFailure("version_conflict","editor.recover-version",null);
        if(state.pending){const config=tutorConfiguration();const {runtime,request:aiRequest}=await createTutorRuntime(config,access.owner,state,editorRequest,request.signal);await processTutorAi(runtime,env.BUCKET,access.owner,input.id,config.pricing,aiRequest,dispatchTutor,request.signal);}break;
      }
    }
    return privateJson(await readEditorView(access.owner,input.id),200);
  }catch(error:unknown){return tutorErrorResponse(error);}
}
