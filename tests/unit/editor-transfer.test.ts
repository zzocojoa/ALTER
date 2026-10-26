import { describe,it,expect } from "vitest";
import { beginTutorVariation,finishTutorVariation,tutorIndependentCandidate } from "../../lib/tutor/variation";
import { saveTutorAnswer,beginTutorDiagnosis,finishTutorDiagnosis,finishTutorSession } from "../../lib/tutor/state";
import { repeatsPreviousAnswer } from "../../lib/tutor/identity";
import { publicEditorView } from "../../lib/editor/view";
import { tutorOutputFixture } from "../fixtures/tutor-output";
import { editorReadyFixture,editorWaitingFixture } from "../fixtures/editor-state";
import { tutorId } from "../fixtures/tutor-state";
import type { TutorState,TutorVariation } from "../../lib/tutor/contracts";
function variation():TutorState {const state=beginTutorVariation(editorReadyFixture());const output=tutorOutputFixture(state);if(output.kind!=="tutor-variation") throw new Error("변형 시험 출력 없음");return finishTutorVariation(state,output,tutorId(80),tutorId(81));}
function diagnosed(state:TutorState,text:string,helped:boolean,correct:boolean):TutorState {const saved=saveTutorAnswer(state,{id:tutorId(82),attemptId:state.question.attemptId,questionId:state.question.id,text,fileIds:[],helped,submittedAt:5});const pending=beginTutorDiagnosis(saved);return finishTutorDiagnosis(pending,{kind:"tutor-diagnosis",questionId:state.question.id,answerId:tutorId(82),readability:"readable",correct,needsHelp:!correct,observation:"시험 답안 검사",citations:[{sourceRefId:state.start.bundle.sources[0].id,quote:state.start.bundle.sources[0].evidence}]});}
describe("Editor 새 조건 수행 분리",()=>{
  it("미완성 초안 보관 종료는 개선 완료나 수행 증거가 아니다",()=>{const before=editorWaitingFixture();const closed=finishTutorSession(before);expect(closed.editor).toEqual(before.editor);expect(tutorIndependentCandidate(closed)).toBeNull();expect(publicEditorView(closed).transfer).toBeNull();expect(closed.answers).toEqual(before.answers);});
  it("수정·이유 재평가 전에 새 문제를 열지 않는다",()=>{expect(()=>beginTutorVariation(editorWaitingFixture())).toThrow();});
  it("문제 ID·공백·표현 기호만 바꾼 재출제를 거부한다",()=>{const state=beginTutorVariation(editorReadyFixture());const output=tutorOutputFixture(state) as TutorVariation;expect(()=>finishTutorVariation(state,{...output,prompt:` ${state.question.prompt} ! `},tutorId(80),tutorId(81))).toThrow();});
  it("새 문제의 답안 대기 중 원본·수정본·도움 본문을 숨긴다",()=>{const state=variation();const view=publicEditorView(state);expect(view.versions).toEqual([]);expect(view.feedbacks).toEqual([]);expect(view.reviews).toEqual([]);expect(view.tutor.sources).toEqual([]);expect(state.variations[0].helpEventIds).toEqual([tutorId(21),tutorId(42)]);expect(tutorIndependentCandidate(state)).toBeNull();});
  it("새 실제 무도움 정답만 후보이며 실패·도움·동일 답안은 제외한다",()=>{const state=variation();expect(tutorIndependentCandidate(diagnosed(state,"2/5",false,true))).toBe(tutorId(82));expect(tutorIndependentCandidate(diagnosed(state,"2/5",true,true))).toBeNull();expect(tutorIndependentCandidate(diagnosed(state,"5/2",false,false))).toBeNull();expect(tutorIndependentCandidate(diagnosed(state,"같은 크기 네 조각 중 한 조각!",false,true))).toBeNull();});
  it("같은 사진의 새 파일 ID도 내용 지문으로 제외한다",()=>{const state=diagnosed(variation(),"사진 답안",false,true);const answer={...state.answers.at(-1)!,text:"",fileIds:[tutorId(85)],contentFingerprint:"a".repeat(64)};expect(repeatsPreviousAnswer(answer,[{...answer,id:tutorId(86),questionId:tutorId(12),fileIds:[tutorId(87)]}])).toBe(true);});
});
