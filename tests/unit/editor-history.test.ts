import { describe,it,expect } from "vitest";
import { validateEditorHistory,editorFeedbackRechecks } from "../../lib/editor/history";
import { submitEditorRevision } from "../../lib/editor/revision";
import { tutorState } from "../../lib/tutor/contracts";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { editorFeedbackFixture } from "../fixtures/editor-output";
import { tutorId } from "../fixtures/tutor-state";
import type { TutorState } from "../../lib/tutor/contracts";
function revised():TutorState {return submitEditorRevision(editorWaitingFixture(),{answerId:tutorId(30),attemptId:tutorId(31),draft:{text:"같은 크기 네 조각 중 하나",fileIds:[]},reason:"전체와 부분 구분",submittedAt:3});}
describe("Editor 연결 이력",()=>{
  it("여러 수정의 원본·직전 버전·피드백·이유를 보존한다",()=>{const first=revised();const feedback={id:tutorId(40),helpEventId:tutorId(41),helpAttemptId:tutorId(42),itemIds:[tutorId(43)],output:editorFeedbackFixture(first),committedAt:4};const waiting=tutorState.parse({...first,editor:{...first.editor,phase:"awaiting-revision",feedbacks:[...first.editor!.feedbacks,feedback]}});const second=submitEditorRevision(waiting,{answerId:tutorId(50),attemptId:tutorId(51),draft:{text:"전체를 같은 크기 네 조각으로 나눈 것 중 한 조각",fileIds:[]},reason:"나눈 기준을 더 정확히 설명",submittedAt:5});expect(()=>validateEditorHistory(second)).not.toThrow();expect(second.editor?.versions.map((item)=>item.parentId)).toEqual([null,tutorId(14),tutorId(30)]);expect(first.editor?.versions).toHaveLength(2);});
  it("존재하지 않는 부모·순환·다른 기준·답안 덮어쓰기를 거부한다",()=>{const state=revised();const editor=state.editor!;for(const patch of [{parentId:tutorId(99)},{parentId:tutorId(30)},{planVersionId:tutorId(99)},{text:"몰래 바꾼 원본"},{feedbackId:tutorId(99)}]) expect(()=>validateEditorHistory({...state,editor:{...editor,versions:[editor.versions[0],{...editor.versions[1],...patch}]}})).toThrow();});
  it("관련 출처만 재검토하고 과거 피드백을 변경하지 않는다",()=>{const state=editorWaitingFixture();expect(editorFeedbackRechecks(state,[tutorId(99)],false,null)[0].reason).toBeNull();expect(editorFeedbackRechecks(state,[tutorId(7)],false,null)[0].reason).toBe("source-changed");expect(editorFeedbackRechecks(state,[],true,null)[0].reason).toBe("criterion-changed");expect(editorFeedbackRechecks(state,[],false,tutorId(99))[0].reason).toBe("result-corrected");expect(state.editor?.feedbacks[0].output.items).toHaveLength(1);});
});
