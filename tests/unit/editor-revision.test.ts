import { describe,it,expect } from "vitest";
import { saveEditorRevisionDraft,submitEditorRevision } from "../../lib/editor/revision";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { tutorId } from "../fixtures/tutor-state";
describe("Editor 수정본·이유 대기",()=>{
  it.each([{text:"",reason:"이유"},{text:"수정",reason:""},{text:"수정",reason:"   "},{text:"   ",reason:"이유"}])("누락 입력은 평가 대기를 만들지 않는다 %j",({text,reason})=>{const state=editorWaitingFixture();expect(()=>submitEditorRevision(state,{answerId:tutorId(30),attemptId:tutorId(31),draft:{text,fileIds:[]},reason,submittedAt:3})).toThrow();expect(state.editor?.phase).toBe("awaiting-revision");});
  it("자동 저장은 사용자 대기 상태를 유지한다",()=>{const state=editorWaitingFixture();const draft=saveEditorRevisionDraft(state,{text:"고치는 중",fileIds:[]},"이유도 작성 중");expect(draft.editor?.phase).toBe("awaiting-revision");expect(draft.editor?.draftReason).toBe("이유도 작성 중");expect(draft.pending).toBeNull();expect(state.draft.text).toBe("1/4은 네 조각");});
  it("직접 고친 내용과 이유를 새 버전에 보존하며 같은 초안 재제출은 거부한다",()=>{const state=editorWaitingFixture();const value={answerId:tutorId(30),attemptId:tutorId(31),draft:{text:"같은 크기 네 조각 중 한 조각",fileIds:[]},reason:"전체와 선택 부분을 구분했다",submittedAt:3};expect(()=>submitEditorRevision(state,{...value,draft:state.draft})).toThrow();const next=submitEditorRevision(state,value);expect(next.editor?.phase).toBe("revision-saved");expect(next.editor?.versions).toHaveLength(2);expect(next.editor?.versions[1]).toMatchObject({parentId:tutorId(14),feedbackId:tutorId(20),reason:value.reason});expect(next.answers.at(-1)?.helped).toBe(true);expect(next.diagnosis).toBeNull();expect(()=>submitEditorRevision(next,value)).toThrow();});
});
