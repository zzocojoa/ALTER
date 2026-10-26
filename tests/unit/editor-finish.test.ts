import { it,expect } from "vitest";
import { finishEditorSession } from "../../lib/editor/review";
import { editorWaitingFixture,editorReadyFixture } from "../fixtures/editor-state";
import { beginEditorReview } from "../../lib/editor/review";
import { submitEditorRevision } from "../../lib/editor/revision";
import { tutorId } from "../fixtures/tutor-state";

it("미해결 피드백과 개선 판정을 바꾸지 않고 기록을 보관한다",()=>{
  for(const state of [editorWaitingFixture(),editorReadyFixture()]){const next=finishEditorSession(state);expect(next.phase).toBe("finished");expect(next.editor).toEqual(state.editor);expect(next.answers).toEqual(state.answers);expect(next.diagnosis).toBeNull();expect(state.phase).toBe("answer-saved");}
});
it("진행 중인 유료 요청이나 일반 수업은 첨삭 종료로 닫지 않는다",()=>{
  const waiting=editorWaitingFixture();const pending=beginEditorReview(submitEditorRevision(waiting,{answerId:tutorId(30),attemptId:tutorId(31),draft:{text:"같은 크기 네 조각 중 한 조각",fileIds:[]},reason:"전체와 부분 구분",submittedAt:3}));
  expect(()=>finishEditorSession(pending)).toThrow();expect(()=>finishEditorSession({...waiting,editor:undefined})).toThrow();
});
