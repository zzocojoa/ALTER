import { describe,it,expect } from "vitest";
import { initialEditor,recordEditorDraft } from "../../lib/editor/state";
import { saveTutorAnswer } from "../../lib/tutor/state";
import { tutorId,tutorStartFixture } from "../fixtures/tutor-state";

describe("Editor 불변 초안",()=>{
  it("초안 제출 이전에는 버전이나 평가를 만들지 않는다",()=>{const state=initialEditor(tutorId(11),tutorStartFixture(),tutorId(12),tutorId(13));expect(state.editor?.versions).toEqual([]);expect(state.pending).toBeNull();expect(()=>recordEditorDraft(state)).toThrow();});
  it("실제 답안·기준 버전을 연결하고 원래 상태를 바꾸지 않는다",()=>{const state=initialEditor(tutorId(11),tutorStartFixture(),tutorId(12),tutorId(13));const submitted=saveTutorAnswer(state,{id:tutorId(14),questionId:state.question.id,attemptId:state.question.attemptId,text:"내 초안",fileIds:[],submittedAt:1,helped:false});const next=recordEditorDraft(submitted);expect(next.editor?.versions[0]).toMatchObject({answerId:tutorId(14),parentId:null,reason:null,text:"내 초안",planVersionId:state.start.bundle.unit.planVersionId});expect(state.editor?.versions).toEqual([]);expect(()=>recordEditorDraft(next)).toThrow();});
});
