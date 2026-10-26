import { describe,it,expect } from "vitest";
import { recordId } from "../../lib/domain/contracts";
import { initialTutor } from "../../lib/tutor/state";
import type { TutorState } from "../../lib/tutor/contracts";
import { tutorStartFixture,tutorId } from "../fixtures/tutor-state";
import { reviewBinding,makeReviewTask } from "../../lib/reviews/contracts";
import { requireReviewAcceptance,reviewAcceptanceRequest,REVIEW_ACCEPTANCE_ID,REVIEW_ACCEPTANCE_ANSWER } from "../../lib/reviews/acceptance";
import { EDITOR_ACCEPTANCE_VARIATION } from "../../lib/editor/acceptance-fixture";
import { ADVISOR_ACCEPTANCE_ID } from "../../lib/advisor/acceptance";
import { LIBRARIAN_ACCEPTANCE_ID,STUDY_ACCEPTANCE_TEXT } from "../../lib/librarian/acceptance-fixture";
function fixed():TutorState {
  const original=tutorStartFixture();const start={...original,scopeId:recordId.parse(LIBRARIAN_ACCEPTANCE_ID),bundle:{...original.bundle,unit:{...original.bundle.unit,planId:recordId.parse(ADVISOR_ACCEPTANCE_ID)},sources:[{...original.bundle.sources[0],evidence:STUDY_ACCEPTANCE_TEXT}]}};const state=initialTutor(REVIEW_ACCEPTANCE_ID,start,tutorId(1211),tutorId(1212));
  return {...state,review:reviewBinding.parse({reviewId:tutorId(1213),reviewVersion:1,planVersion:2,scheduleId:tutorId(1214),proposalId:tutorId(1214),basisResultVersionId:tutorId(1215),baselineAt:1,dueDate:"2026-10-25",kind:"variable",task:makeReviewTask("concept",start.bundle.unit.selfExplanationCriterion,tutorId(1216),EDITOR_ACCEPTANCE_VARIATION,[start.bundle.sources[0].id]),correctionId:null}),answers:[{id:tutorId(1217),questionId:state.question.id,attemptId:state.question.attemptId,text:REVIEW_ACCEPTANCE_ANSWER,fileIds:[],submittedAt:2,helped:false}],pending:{key:"fixed-review",kind:"tutor-diagnosis"}};
}
describe("복습 고정 시험 입력 경계",()=>{
  it("승인한 분수 입력과 진단만 허용한다",()=>{const state=fixed();expect(()=>requireReviewAcceptance(state)).not.toThrow();expect(reviewAcceptanceRequest(state,[]).responseContract).toBe("tutor-diagnosis");expect(()=>reviewAcceptanceRequest({...state,pending:{key:"fixed-review",kind:"tutor-lesson"}},[])).toThrow();});
  it("다른 회차·개인 답안·출처·정정된 질문을 거부한다",()=>{const state=fixed();expect(()=>requireReviewAcceptance({...state,id:tutorId(999)})).toThrow();expect(()=>requireReviewAcceptance({...state,answers:[{...state.answers[0],text:"개인 학습 답안"}]})).toThrow();expect(()=>requireReviewAcceptance({...state,start:{...state.start,bundle:{...state.start.bundle,sources:[{...state.start.bundle.sources[0],evidence:"개인 교재"}]}}})).toThrow();const binding=state.review;if(!binding) throw new Error("시험 복습 연결 누락");expect(()=>requireReviewAcceptance({...state,review:{...binding,correctionId:tutorId(99)}})).toThrow();expect(()=>requireReviewAcceptance({...state,review:{...binding,task:{...binding.task,criterion:"개인 수정 기준"}}})).toThrow();});
  it("사진을 고정 시험으로 보내지 않는다",()=>{const state=fixed();expect(()=>requireReviewAcceptance({...state,answers:[{...state.answers[0],fileIds:[tutorId(99)]}]})).toThrow();expect(()=>reviewAcceptanceRequest(state,[{type:"input_image",sourceRefId:tutorId(99),dataUrl:"data:image/png;base64,AAAA",bytes:3,width:1,height:1,detail:"low"}])).toThrow();});
});
