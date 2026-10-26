import { env } from "cloudflare:workers";
import { z } from "zod";
import { materialMutationAccess,materialOwnerAccess } from "@/lib/materials/server-access";
import { readBoundedJson } from "@/lib/materials/request";
import { privateJson } from "@/lib/owner-access";
import { readStorage } from "@/db/repositories/atomic";
import { getTutor } from "@/db/repositories/tutor";
import { createEditor,submitStoredEditorDraft } from "@/db/repositories/editor";
import { submitStoredEditorRevision } from "@/db/repositories/editor-revision";
import { beginStoredEditorFeedback } from "@/db/repositories/editor-feedback";
import { beginStoredEditorReview } from "@/db/repositories/editor-review";
import { dispatchTutorAction,submitStoredTutorAnswer } from "@/db/repositories/tutor-actions";
import { tutorErrorResponse } from "@/lib/tutor/server";
import { readEditorView } from "@/lib/editor/server";
import { EDITOR_ACCEPTANCE_ID,EDITOR_ACCEPTANCE_IDS,EDITOR_ACCEPTANCE_QUESTION,EDITOR_ACCEPTANCE_ATTEMPT,editorAcceptanceAnswers } from "@/lib/editor/acceptance-fixture";
import { requireEditorAcceptance,editorAcceptanceDispatcher,editorAcceptanceRequest } from "@/lib/editor/acceptance";
import { LIBRARIAN_ACCEPTANCE_ID } from "@/lib/librarian/acceptance-fixture";
import { advisorRecordId } from "@/db/repositories/advisor";
import { beginStoredTutorAi,processTutorAi } from "@/lib/tutor/ai";
import { createTutorRuntime,tutorConfiguration } from "@/lib/tutor/runtime";
import { domainFailure,recordId,version } from "@/lib/domain/contracts";
const actions=z.enum(["prepare","draft","feedback","revision","review","variation","answer-new","diagnose","finish","recover"]);
export async function GET(request:Request):Promise<Response> {
  const access=await materialOwnerAccess();if(access.rejection) return access.rejection;
  try {const id=z.enum(EDITOR_ACCEPTANCE_IDS).parse(new URL(request.url).searchParams.get("id"));const found=await readStorage("editor.acceptance-existing",()=>env.DB.prepare("SELECT COUNT(*) AS n FROM tutor_sessions WHERE owner_id=? AND id=?").bind(access.owner.userId,id).first<number>("n"));return privateJson({view:found===1 ? await readEditorView(access.owner,id) : null},200);}catch(error:unknown){return tutorErrorResponse(error);}
}
export async function POST(request:Request):Promise<Response> {
  const access=await materialMutationAccess(request);if(access.rejection) return access.rejection;
  try {
    const input=z.object({id:z.enum(EDITOR_ACCEPTANCE_IDS),action:actions,expectedVersion:version}).strict().parse(await readBoundedJson(request,2048));const cmd={owner:access.owner,requestKey:await advisorRecordId(`editor-acceptance:${input.id}:${input.action}:${input.expectedVersion}`),expectedVersion:input.expectedVersion};
    if(input.action==="prepare") await createEditor(env.DB,env.BUCKET,cmd,{id:input.id,scopeId:LIBRARIAN_ACCEPTANCE_ID,questionId:input.id===EDITOR_ACCEPTANCE_ID ? EDITOR_ACCEPTANCE_QUESTION : await advisorRecordId(`${input.id}:question`),attemptId:input.id===EDITOR_ACCEPTANCE_ID ? EDITOR_ACCEPTANCE_ATTEMPT : await advisorRecordId(`${input.id}:attempt`)},Date.now());
    else {
      let state=await getTutor(env.DB,access.owner,input.id);requireEditorAcceptance(state);if(state.version!==input.expectedVersion) throw domainFailure("version_conflict","editor.acceptance-version",null);
      const answerId=recordId.parse(await advisorRecordId(`editor-acceptance-answer:${input.id}:${input.action}:${state.version}`));
      if(input.action==="draft") await submitStoredEditorDraft(env.DB,env.BUCKET,cmd,state.id,answerId,{text:editorAcceptanceAnswers.draft,fileIds:[]},Date.now());
      else if(input.action==="revision") await submitStoredEditorRevision(env.DB,env.BUCKET,cmd,state.id,{answerId,attemptId:recordId.parse(await advisorRecordId(`editor-acceptance-attempt:${input.id}:${state.version}`)),draft:{text:editorAcceptanceAnswers.revision,fileIds:[]},reason:editorAcceptanceAnswers.reason,submittedAt:Date.now()});
      else if(input.action==="answer-new") await submitStoredTutorAnswer(env.DB,env.BUCKET,cmd,state.id,answerId,{text:editorAcceptanceAnswers.variation,fileIds:[]},Date.now());
      else if(input.action==="finish") await dispatchTutorAction(env.DB,env.BUCKET,cmd,{action:"finish",id:state.id,expectedVersion:state.version},Date.now());
      else {if(input.action==="feedback") await beginStoredEditorFeedback(env.DB,env.BUCKET,cmd,state.id);else if(input.action==="review") await beginStoredEditorReview(env.DB,env.BUCKET,cmd,state.id);else if(input.action!=="recover") await beginStoredTutorAi(env.DB,env.BUCKET,cmd,state.id,input.action);state=await getTutor(env.DB,access.owner,state.id);if(state.pending){const config=tutorConfiguration();const {runtime,request:aiRequest}=await createTutorRuntime(config,access.owner,state,editorAcceptanceRequest,request.signal);await processTutorAi(runtime,env.BUCKET,access.owner,state.id,config.pricing,aiRequest,editorAcceptanceDispatcher(state),request.signal);}}
    }
    return privateJson({view:await readEditorView(access.owner,input.id)},200);
  }catch(error:unknown){return tutorErrorResponse(error);}
}
