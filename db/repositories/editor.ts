import { domainFailure } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { initialEditor,recordEditorDraft } from "../../lib/editor/state.ts";
import { tutorState } from "../../lib/tutor/contracts.ts";
import type { TutorDraft } from "../../lib/tutor/contracts.ts";
import { executeAtomic,readStorage } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { tutorCreationStatements,saveTutorTransition } from "./tutor.ts";
import { prepareTutorSubmission,tutorAnswerStatements } from "./tutor-actions.ts";
import { readTutorStart } from "./tutor-start.ts";

export async function createEditor(db:D1Database,bucket:R2Bucket,cmd:Command,input:Readonly<{id:string;scopeId:string;questionId:string;attemptId:string}>,now:number):Promise<Receipt> {
  if(cmd.expectedVersion!==1) throw domainFailure("version_conflict","editor.start-version",null);
  const previous=await readStorage("editor.start-replay",()=>db.prepare("SELECT content FROM tutor_events WHERE owner_id=? AND session_id=? AND version=1").bind(cmd.owner.userId,input.id).first<{content:string}>());
  const state=previous ? tutorState.parse(JSON.parse(previous.content).state) : initialEditor(input.id,await readTutorStart(db,bucket,cmd.owner,input.scopeId,now),input.questionId,input.attemptId);
  if(!state.editor) throw domainFailure("reference_conflict","editor.session-kind",null);
  return executeAtomic(db,cmd,"editor.start",input,state.id,1,(requestId)=>tutorCreationStatements(db,cmd,state,requestId,input));
}
export async function submitStoredEditorDraft(db:D1Database,bucket:R2Bucket,cmd:Command,id:string,answerId:string,draft:TutorDraft,now:number):Promise<Receipt> {
  const submission=await prepareTutorSubmission(db,bucket,cmd,id,answerId,draft,now);const state=recordEditorDraft(submission.state);
  return saveTutorTransition(db,cmd,state,"editor-draft",{id,answerId,draft},(requestId)=>tutorAnswerStatements(db,cmd,{...submission,state},requestId));
}
