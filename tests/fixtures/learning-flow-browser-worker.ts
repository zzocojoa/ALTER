import { z } from "zod";
import { siteIdentity, recordId, command } from "../../lib/domain/contracts";
import { tutorAction } from "../../lib/tutor/request";
import { editorAction } from "../../lib/editor/actions";
import { resultRequest } from "../../lib/results/contracts";
import { publicTutorView } from "../../lib/tutor/view";
import { publicEditorView } from "../../lib/editor/view";
import { getTutor } from "../../db/repositories/tutor";
import { dispatchTutorAction, saveStoredTutorDraft } from "../../db/repositories/tutor-actions";
import { createEditor, submitStoredEditorDraft } from "../../db/repositories/editor";
import { saveStoredEditorRevisionDraft, submitStoredEditorRevision } from "../../db/repositories/editor-revision";
import { beginStoredEditorFeedback } from "../../db/repositories/editor-feedback";
import { beginStoredEditorReview } from "../../db/repositories/editor-review";
import { beginStoredTutorAi } from "../../lib/tutor/ai";
import { readResultSnapshot } from "../../db/repositories/result-draft";
import { confirmSessionResult } from "../../db/repositories/result-confirmation";
import { readSessionResume } from "../../db/repositories/session-resume";
import { isDomainFailure } from "../../db/repositories/atomic";
import { prepareLearningFlow, selectLearningFlowScope } from "./learning-flow-setup";
import type { LearningFlowEnvironment } from "./learning-flow-setup";
import { learningFlowCases } from "./learning-flow-cases";
import { completePending } from "./learning-flow-worker";

const flowSchema=z.object({owner:siteIdentity,courseId:recordId,materialId:recordId,sourceId:recordId,linkId:recordId,scopeId:recordId}).strict();
const envelope=z.object({flow:flowSchema,input:z.unknown(),requestKey:z.string().min(1)}).strict();

/** 로컬 Playwright 전용 진입점입니다. 실제 저장소를 사용하고 모델만 결정적 대역으로 실행합니다. */
async function execute(request:Request,env:LearningFlowEnvironment):Promise<Response> {
  const url=new URL(request.url);const scenario=learningFlowCases.find((item)=>item.domain===url.searchParams.get("domain"));
  if(!scenario || request.method!=="POST") throw new Error("로컬 통합 검사의 분야와 POST 요청이 필요합니다.");
  if(url.pathname==="/prepare") return Response.json(await prepareLearningFlow(env,scenario));
  const {flow,input,requestKey}=envelope.parse(await request.json());
  if(url.pathname==="/scope") return Response.json(await selectLearningFlowScope(env,flow,scenario));
  if(url.pathname==="/state") return Response.json(await readSessionResume(env.DB,flow.owner,recordId.parse(input)));
  if(url.pathname==="/view/tutor") return Response.json(publicTutorView(await getTutor(env.DB,flow.owner,recordId.parse(input))));
  if(url.pathname==="/view/editor") return Response.json(publicEditorView(await getTutor(env.DB,flow.owner,recordId.parse(input))));
  if(url.pathname==="/view/results") return Response.json((await readResultSnapshot(env.DB,flow.owner,recordId.parse(input))).draft);
  if(url.pathname==="/action/tutor") {
    const action=tutorAction.parse(input);const cmd=command.parse({owner:flow.owner,requestKey,expectedVersion:"expectedVersion" in action ? action.expectedVersion : 1});
    if(action.action==="lesson" || action.action==="diagnose" || action.action==="variation") {await beginStoredTutorAi(env.DB,env.BUCKET,cmd,action.id,action.action);await completePending(env,flow,action.id,scenario);}
    else if(action.action==="help" || action.action==="recover") throw new Error("이 통합 시나리오는 도움 생성과 재시도를 요청하지 않습니다.");
    else await dispatchTutorAction(env.DB,env.BUCKET,cmd,action,Date.now());
    return Response.json(publicTutorView(await getTutor(env.DB,flow.owner,action.id)));
  }
  if(url.pathname==="/action/editor") {
    const action=editorAction.parse(input);const cmd=command.parse({owner:flow.owner,requestKey,expectedVersion:"expectedVersion" in action ? action.expectedVersion : 1});
    switch(action.action){
      case "start":await createEditor(env.DB,env.BUCKET,cmd,action,Date.now());break;
      case "draft":await saveStoredTutorDraft(env.DB,env.BUCKET,cmd,action.id,action.draft);break;
      case "submit":await submitStoredEditorDraft(env.DB,env.BUCKET,cmd,action.id,action.answerId,action.draft,Date.now());break;
      case "revision-draft":await saveStoredEditorRevisionDraft(env.DB,env.BUCKET,cmd,action.id,action.draft,action.reason);break;
      case "revision-submit":await submitStoredEditorRevision(env.DB,env.BUCKET,cmd,action.id,{answerId:action.answerId,attemptId:action.attemptId,draft:action.draft,reason:action.reason,submittedAt:Date.now()});break;
      case "feedback":await beginStoredEditorFeedback(env.DB,env.BUCKET,cmd,action.id);await completePending(env,flow,action.id,scenario);break;
      case "review":await beginStoredEditorReview(env.DB,env.BUCKET,cmd,action.id);await completePending(env,flow,action.id,scenario);break;
      case "variation":await beginStoredTutorAi(env.DB,env.BUCKET,cmd,action.id,"variation");await completePending(env,flow,action.id,scenario);break;
      default:throw new Error(`통합 시나리오에 없는 Editor 동작: ${action.action}`);
    }
    return Response.json(publicEditorView(await getTutor(env.DB,flow.owner,action.id)));
  }
  if(url.pathname==="/action/results") {
    const action=resultRequest.parse(input);await confirmSessionResult(env.DB,command.parse({owner:flow.owner,requestKey,expectedVersion:action.expectedVersion}),action,Date.now());
    return Response.json((await readResultSnapshot(env.DB,flow.owner,action.id)).draft);
  }
  throw new Error(`지원하지 않는 로컬 통합 검사 경로: ${url.pathname}`);
}
async function fetch(request:Request,env:LearningFlowEnvironment):Promise<Response> {
  try {return await execute(request,env);}
  catch(error:unknown){if(isDomainFailure(error)) return Response.json({error:error.code,message:error.message,operation:error.operation},{status:409});if(error instanceof z.ZodError) return Response.json({error:"input-invalid",issues:error.issues},{status:400});throw error;}
}
const worker={fetch};
export default worker;
