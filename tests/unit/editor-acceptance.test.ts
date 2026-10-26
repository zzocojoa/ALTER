import { recordId } from "../../lib/domain/contracts";
import { describe,it,expect } from "vitest";
import { requireEditorAcceptance,editorAcceptanceRequest } from "../../lib/editor/acceptance";
import { EDITOR_ACCEPTANCE_ID,EDITOR_FEEDBACK_ACCEPTANCE_ID,EDITOR_ACCEPTANCE_TASK,editorAcceptanceAnswers } from "../../lib/editor/acceptance-fixture";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { LIBRARIAN_ACCEPTANCE_ID,STUDY_ACCEPTANCE_TEXT } from "../../lib/librarian/acceptance-fixture";
import { initialEditor } from "../../lib/editor/state";
import { tutorStartFixture,tutorId } from "../fixtures/tutor-state";
import type { TutorState } from "../../lib/tutor/contracts";
function fixed():TutorState {
  const start=tutorStartFixture();const source=start.bundle.sources[0];
  return initialEditor(EDITOR_ACCEPTANCE_ID,{...start,scopeId:recordId.parse(LIBRARIAN_ACCEPTANCE_ID),bundle:{...start.bundle,unit:{...start.bundle.unit,planId:recordId.parse(ADVISOR_ACCEPTANCE_ID)},exercise:{...start.bundle.exercise,text:EDITOR_ACCEPTANCE_TASK},sources:[{...source,evidence:STUDY_ACCEPTANCE_TEXT,spanEnd:Array.from(STUDY_ACCEPTANCE_TEXT).length}]}},tutorId(1011),tutorId(1012));
}
describe("Editor 승인된 고정 입력 경계",()=>{
  it("고정 시험만 허용하고 일반 회차를 거부한다",()=>{const state=fixed();expect(()=>requireEditorAcceptance(state)).not.toThrow();expect(()=>requireEditorAcceptance({...state,id:recordId.parse(EDITOR_FEEDBACK_ACCEPTANCE_ID)})).not.toThrow();expect(()=>requireEditorAcceptance({...state,id:tutorId(999)})).toThrow();});
  it("다른 교재나 과제를 고정 검증으로 보내지 않는다",()=>{const state=fixed();expect(()=>requireEditorAcceptance({...state,start:{...state.start,bundle:{...state.start.bundle,sources:[{...state.start.bundle.sources[0],evidence:"개인 자료"}]}}})).toThrow();expect(()=>requireEditorAcceptance({...state,start:{...state.start,bundle:{...state.start.bundle,exercise:{...state.start.bundle.exercise,text:"개인 과제"}}}})).toThrow();});
  it("개인 답안·사진 첨부를 거부한다",()=>{const state=fixed();const answer={id:tutorId(14),questionId:state.question.id,attemptId:state.question.attemptId,text:editorAcceptanceAnswers.draft,fileIds:[],submittedAt:1,helped:false};expect(()=>requireEditorAcceptance({...state,answers:[answer]})).not.toThrow();expect(()=>requireEditorAcceptance({...state,answers:[{...answer,text:"개인 답안"}]})).toThrow();expect(()=>requireEditorAcceptance({...state,answers:[{...answer,fileIds:[tutorId(55)]}]})).toThrow();expect(()=>editorAcceptanceRequest(state,[{type:"input_image",sourceRefId:tutorId(55),dataUrl:"data:image/png;base64,AAAA",bytes:3,width:1,height:1,detail:"low"}])).toThrow();});
});
