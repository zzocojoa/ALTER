import { describe,it,expect } from "vitest";
import { recordId } from "../../lib/domain/contracts";
import { initialTutor } from "../../lib/tutor/state";
import type { TutorState } from "../../lib/tutor/contracts";
import { tutorStartFixture,tutorId } from "../fixtures/tutor-state";
import { requireTutorAcceptance,tutorAcceptanceRequest,tutorAcceptanceAnswers } from "../../lib/tutor/acceptance";
import { TUTOR_ACCEPTANCE_ID,TUTOR_DIRECTION_ACCEPTANCE_ID,TUTOR_HELP_ACCEPTANCE_ID } from "../../lib/tutor/acceptance-fixture";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { LIBRARIAN_ACCEPTANCE_ID,LIBRARIAN_HELP_ACCEPTANCE_ID,STUDY_ACCEPTANCE_TEXT } from "../../lib/librarian/acceptance-fixture";
function fixed():TutorState {
  const start=tutorStartFixture();
  return initialTutor(TUTOR_HELP_ACCEPTANCE_ID,{...start,scopeId:recordId.parse(LIBRARIAN_HELP_ACCEPTANCE_ID),bundle:{...start.bundle,unit:{...start.bundle.unit,planId:recordId.parse(ADVISOR_ACCEPTANCE_ID)},sources:[{...start.bundle.sources[0],evidence:STUDY_ACCEPTANCE_TEXT}]}},tutorId(930),tutorId(931));
}
describe("도움 검증의 고정 입력과 기존 이력 경계",()=>{
  it("새 회차는 새 범위에만 연결하고 과거 회차의 범위는 유지한다",()=>{
    const state=fixed();expect(()=>requireTutorAcceptance(state)).not.toThrow();
    expect(()=>requireTutorAcceptance({...state,start:{...state.start,scopeId:recordId.parse(LIBRARIAN_ACCEPTANCE_ID)}})).toThrow();
    for(const id of [TUTOR_ACCEPTANCE_ID,TUTOR_DIRECTION_ACCEPTANCE_ID]) {
      expect(()=>requireTutorAcceptance({...state,id:recordId.parse(id)})).toThrow();
      expect(()=>requireTutorAcceptance({...state,id:recordId.parse(id),start:{...state.start,scopeId:recordId.parse(LIBRARIAN_ACCEPTANCE_ID)}})).not.toThrow();
    }
    expect(()=>requireTutorAcceptance({...state,id:tutorId(999)})).toThrow();
  });
  it("같은 시험 답안만 허용하고 개인 자료와 사진 전송은 거부한다",()=>{
    const state=fixed();const answer={id:tutorId(932),questionId:state.question.id,attemptId:state.question.attemptId,text:tutorAcceptanceAnswers.unsure,fileIds:[],submittedAt:1,helped:false};
    expect(()=>requireTutorAcceptance({...state,answers:[answer]})).not.toThrow();
    expect(()=>requireTutorAcceptance({...state,answers:[{...answer,text:"개인 학습 답안"}]})).toThrow();
    expect(()=>requireTutorAcceptance({...state,answers:[{...answer,fileIds:[tutorId(933)]}]})).toThrow();
    expect(()=>requireTutorAcceptance({...state,start:{...state.start,bundle:{...state.start.bundle,sources:[{...state.start.bundle.sources[0],evidence:"개인 교재"}]}}})).toThrow();
    expect(()=>tutorAcceptanceRequest(state,[{type:"input_image",sourceRefId:tutorId(933),dataUrl:"data:image/png;base64,AAAA",bytes:3,width:1,height:1,detail:"low"}])).toThrow();
  });
});
