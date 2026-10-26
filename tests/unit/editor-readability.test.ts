import { describe, expect, it } from "vitest";
import { validateEditorFeedback } from "../../lib/editor/evidence";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { editorFeedbackFixture } from "../fixtures/editor-output";
import { tutorId } from "../fixtures/tutor-state";
import type { TutorState } from "../../lib/tutor/contracts";
describe("첨삭 가독성은 실제 사진의 판독 근거를 요구한다",()=>{
  it("교재 인용이 맞아도 타이핑한 글의 가독성 오판은 저장하지 않는다",()=>{
    const state=editorWaitingFixture();const output=editorFeedbackFixture(state);
    expect(()=>validateEditorFeedback(state,{...output,items:[{...output.items[0],issue:"readability",direction:"clarify-writing"}]})).toThrow();
    expect(()=>validateEditorFeedback(state,output)).not.toThrow();
    expect(()=>validateEditorFeedback(state,{...output,items:[],verdict:"no-issue-evidenced"})).not.toThrow();
  });
  it("실제로 첨부된 사진의 판독 불가 영역은 계속 지적할 수 있다",()=>{
    const original=editorWaitingFixture();const fileId=tutorId(98);
    const state:TutorState={...original,answers:original.answers.map(a=>({...a,fileIds:[fileId]})),editor:{...original.editor!,versions:original.editor!.versions.map(v=>({...v,fileIds:[fileId]}))}};
    const output=editorFeedbackFixture(state);
    const feedback={...output,basis:[{...output.basis[0],location:{kind:"image" as const,fileId,left:0,top:0,right:1,bottom:1}}],items:[{...output.items[0],issue:"readability" as const,direction:"clarify-writing" as const}]};
    expect(()=>validateEditorFeedback(state,feedback)).not.toThrow();
    expect(()=>validateEditorFeedback(original,feedback)).toThrow();
  });
});
