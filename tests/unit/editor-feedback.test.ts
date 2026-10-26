import { describe,it,expect } from "vitest";
import { editorFeedbackOutput } from "../../lib/editor/contracts";
import { validateEditorFeedback } from "../../lib/editor/evidence";
import { initialEditor,recordEditorDraft } from "../../lib/editor/state";
import { beginEditorFeedback,finishEditorFeedback } from "../../lib/editor/feedback";
import { saveTutorAnswer } from "../../lib/tutor/state";
import { tutorId,tutorStartFixture } from "../fixtures/tutor-state";
import { editorFeedbackFixture } from "../fixtures/editor-output";
import type { TutorState } from "../../lib/tutor/contracts";
export function savedEditorFixture():TutorState {const state=initialEditor(tutorId(11),tutorStartFixture(),tutorId(12),tutorId(13));return recordEditorDraft(saveTutorAnswer(state,{id:tutorId(14),questionId:state.question.id,attemptId:state.question.attemptId,text:"1/4은 네 조각",fileIds:[],submittedAt:1,helped:false}));}
describe("Editor 근거·답안 비노출",()=>{
  it.each([0,1,2])("문제 %i개를 허용하고 근거 없는 지적을 강제하지 않는다",(n)=>{const state=savedEditorFixture();const output=editorFeedbackFixture(state);const value=editorFeedbackOutput.parse({...output,items:Array.from({length:n},()=>output.items[0]),verdict:n===0 ? "no-issue-evidenced" : "issues-found"});expect(()=>validateEditorFeedback(state,value)).not.toThrow();});
  it("원문이 같아도 실제 글 끝을 넘는 구간은 거부한다",()=>{const state=savedEditorFixture();const output=editorFeedbackFixture(state);expect(()=>validateEditorFeedback(state,{...output,basis:[{...output.basis[0],location:{kind:"text",start:0,end:9999,quote:state.answers[0].text}}]})).toThrow();});
  it("3개 지적과 완성 답안 필드를 거부한다",()=>{const output=editorFeedbackFixture(savedEditorFixture());expect(()=>editorFeedbackOutput.parse({...output,items:[...output.items,...output.items,...output.items]})).toThrow();expect(()=>editorFeedbackOutput.parse({...output,replacementAnswer:"전체 답안"})).toThrow();expect(()=>editorFeedbackOutput.parse({...output,items:[{...output.items[0],direction:"정답을 대신 제공"}]})).toThrow();});
  it("다른 답안·초안에 없는 구간·기준·출처를 거부한다",()=>{const state=savedEditorFixture();const output=editorFeedbackFixture(state);expect(()=>validateEditorFeedback(state,{...output,answerId:tutorId(99)})).toThrow();expect(()=>validateEditorFeedback(state,{...output,basis:[{...output.basis[0],location:{kind:"text",start:0,end:1,quote:"없음"}}]})).toThrow();expect(()=>validateEditorFeedback(state,{...output,basis:[{...output.basis[0],criterionQuote:"관계없는 기준"}]})).toThrow();expect(()=>validateEditorFeedback(state,{...output,items:[{...output.items[0],citations:[{sourceRefId:tutorId(99),quote:"없는 출처"}]}]})).toThrow();});
  it("다른 사진·잘못된 범위·문제와 다른 수정 방향을 거부한다",()=>{const state=savedEditorFixture();const output=editorFeedbackFixture(state);expect(()=>validateEditorFeedback(state,{...output,basis:[{...output.basis[0],location:{kind:"image",fileId:tutorId(99),left:0,top:0,right:1,bottom:1}}]})).toThrow();expect(()=>validateEditorFeedback(state,{...output,items:[{...output.items[0],direction:"check-calculation"}]})).toThrow();});
  it("피드백 열람만으로 완료되거나 원본을 변경하지 않는다",()=>{const state=beginEditorFeedback(savedEditorFixture());const output=editorFeedbackFixture(state);const next=finishEditorFeedback(state,{id:tutorId(20),helpEventId:tutorId(21),helpAttemptId:tutorId(23),itemIds:[tutorId(22)],output,committedAt:2});expect(next.editor?.phase).toBe("awaiting-revision");expect(next.editor?.versions).toEqual(state.editor?.versions);expect(next.diagnosis).toBeNull();expect(state.editor?.feedbacks).toEqual([]);});
});
