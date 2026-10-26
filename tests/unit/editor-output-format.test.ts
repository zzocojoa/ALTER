import { it,expect } from "vitest";
import { editorDraftLocations,editorFeedbackTextFormat,editorRevisionTextFormat } from "../../lib/editor/output-format";
import { editorFeedbackFixture,editorResolvedFixture } from "../fixtures/editor-output";
import { editorWaitingFixture } from "../fixtures/editor-state";
import { beginEditorReview } from "../../lib/editor/review";
import { submitEditorRevision } from "../../lib/editor/revision";
import { tutorId } from "../fixtures/tutor-state";
import { prepareAiRequest,tokenCountPayload } from "../../lib/ai/request-bound";
import { editorRequest } from "../../lib/editor/request";

it("정확한 인용문이라도 계산이 틀린 위치는 출력 형식에서 거부한다",()=>{
  const text="개발 검증용 합성 오답입니다. 커피 체리 안의 씨앗은 원두입니다. 이것을 볶으면 생두가 되고, 분쇄한 생두를 추출합니다.";
  const output=editorFeedbackFixture(editorWaitingFixture());const place=editorDraftLocations(text)[0];
  const value={result:{...output,basis:[{...output.basis[0],location:place}]}};const format=editorFeedbackTextFormat(text);
  expect(format.$parseRaw(JSON.stringify(value))).toEqual(value);
  expect(()=>format.$parseRaw(JSON.stringify({result:{...value.result,basis:[{...value.result.basis[0],location:{kind:"text",start:29,end:66,quote:"커피 체리 안의 씨앗은 원두입니다. 이것을 볶으면 생두가 되고, 분쇄한 생두를 추출합니다."}}]}}))).toThrow();
});
it("한글과 보조 문자를 포함한 긴 입력의 구간 경계를 보존한다",()=>{
  const text="가😀".repeat(220);const places=editorDraftLocations(text);
  expect(places.map(place=>place.quote).join("")).toBe(text);expect(places.map(place=>[place.start,place.end])).toEqual([[0,200],[200,400],[400,440]]);
  expect(editorDraftLocations("")).toEqual([]);
});
it("수정본과 잔여 피드백도 정확한 구간 형식으로 제한하고 집계 요청과 동일하게 보낸다",async()=>{
  const state=beginEditorReview(submitEditorRevision(editorWaitingFixture(),{answerId:tutorId(30),attemptId:tutorId(31),draft:{text:"같은 크기 네 조각 중 한 조각",fileIds:[]},reason:"전체와 부분 구분",submittedAt:3}));
  const output=editorResolvedFixture(state);const request=editorRequest(state,[]);const prepared=await prepareAiRequest(request);
  expect(editorRevisionTextFormat(request.editorDraftText!).$parseRaw(JSON.stringify({result:output}))).toEqual({result:output});
  expect(tokenCountPayload(prepared).text).toEqual(prepared.body.text);
  expect(JSON.stringify(prepared.body.text)).toContain(request.editorDraftText);
  expect(()=>editorRevisionTextFormat(request.editorDraftText!).$parseRaw(JSON.stringify({result:{...output,checks:output.checks.map(check=>({...check,revisionLocation:{kind:"text",start:1,end:2,quote:"같은"}}))}}))).toThrow();
});
