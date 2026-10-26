import { describe,it,expect } from "vitest";
import { beginEditorReview,finishEditorReview,validateEditorReviewEvidence,cancelEditorEvaluation } from "../../lib/editor/review";
import { submitEditorRevision } from "../../lib/editor/revision";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { editorNeedsRevisionFixture,editorResolvedFixture } from "../fixtures/editor-output";
import { tutorId } from "../fixtures/tutor-state";
import type { TutorState } from "../../lib/tutor/contracts";
import type { EditorReviewOutput } from "../../lib/editor/contracts";
function revised():TutorState {return submitEditorRevision(editorWaitingFixture(),{answerId:tutorId(30),attemptId:tutorId(31),draft:{text:"같은 크기 네 조각 중 하나",fileIds:[]},reason:"전체와 부분 구분",submittedAt:3});}
function finish(state:TutorState,output:EditorReviewOutput):TutorState {return finishEditorReview(state,{id:tutorId(40),output,committedAt:4},{id:tutorId(41),helpEventId:tutorId(42),helpAttemptId:tutorId(43),itemIds:output.remaining.items.map((_item,index)=>tutorId(44+index)),output:output.remaining,committedAt:4});}
describe("Editor 개선 재평가",()=>{
  it("개선돼도 독립 수행 판정은 만들지 않는다",()=>{const state=beginEditorReview(revised());const next=finish(state,editorResolvedFixture(state));expect(next.editor?.phase).toBe("ready-for-recheck");expect(next.answers.at(-1)?.helped).toBe(true);expect(next.diagnosis).toBeNull();expect(next.editor?.versions).toEqual(state.editor?.versions);});
  it("미해결·악화 판정은 다시 수정과 이유를 기다린다",()=>{const state=beginEditorReview(revised());const next=finish(state,editorNeedsRevisionFixture(state));expect(next.editor?.phase).toBe("awaiting-revision");expect(next.editor?.feedbacks).toHaveLength(2);expect(next.editor?.reviews[0].output.checks[0].resolved).toBe(false);});
  it("이유 불일치·없는 수정 구간·이전 버전·모순된 완료를 거부한다",()=>{const state=beginEditorReview(revised());const value=editorResolvedFixture(state);expect(()=>validateEditorReviewEvidence(state,{...value,versionId:tutorId(99)})).toThrow();expect(()=>validateEditorReviewEvidence(state,{...value,checks:[{...value.checks[0],reasonQuote:"없는 이유"}]})).toThrow();expect(()=>validateEditorReviewEvidence(state,{...value,checks:[{...value.checks[0],revisionLocation:{kind:"text",start:0,end:1,quote:"없는 수정"}}]})).toThrow();expect(()=>validateEditorReviewEvidence(state,{...value,checks:[{...value.checks[0],resolved:false}]})).toThrow();});
  it("수정본 끝을 넘는 구간은 원문이 일치해도 거부한다",()=>{const state=beginEditorReview(revised());const output=editorResolvedFixture(state);expect(()=>validateEditorReviewEvidence(state,{...output,checks:[{...output.checks[0],revisionLocation:{kind:"text",start:0,end:9999,quote:state.editor!.versions.at(-1)!.text}}]})).toThrow();});
  it("이유 없는 재검토와 취소 후 늦은 결과를 거부한다",()=>{expect(()=>beginEditorReview(editorWaitingFixture())).toThrow();const state=beginEditorReview(revised());const cancelled=cancelEditorEvaluation(state);expect(()=>finish(cancelled,editorResolvedFixture(state))).toThrow();expect(cancelled.editor?.versions).toEqual(state.editor?.versions);expect(cancelled.editor?.phase).toBe("revision-saved");});
});
