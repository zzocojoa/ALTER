import { describe,it,expect } from "vitest";
import { reportRowExpected,verifyExternalContent } from "../../lib/external/verification";
import type { ExternalObservation } from "../../lib/external/verification";

const document={source:"operation" as const,businessKey:"report:weekly:document-write"};
const values=["weekly:one","1","기간","단원","독립","도움","오답","다음","","version-one"];
const expected=reportRowExpected.parse({kind:"report-row",businessKey:"weekly:one",document,values});
function observation(rows:readonly (readonly string[])[]):ExternalObservation {return {status:"available",externalId:"sheet-id",content:{kind:"report-rows",document,documentId:"verified-document",startRow:1,rows:rows.map(row=>[...row])}};}
const actual=values.map((value,index)=>index===8?"https://docs.google.com/document/d/verified-document/edit":value);
describe("검증 문서 링크와 주간 업무 행",()=>{
  it("행 이동 후에도 업무 키·확정 버전·문서 링크를 검증한다",async()=>{expect(await verifyExternalContent(expected,"sheet-id",observation([["헤더"],[],actual]),1)).toMatchObject({status:"matched",position:3});});
  it("빈 링크·다른 문서 링크·버전 변경·추가 값은 충돌이다",async()=>{for(const row of [values,actual.map((value,index)=>index===8?"https://docs.google.com/document/d/other/edit":value),actual.map((value,index)=>index===9?"version-two":value),[...actual,"추가 값"]]) expect(await verifyExternalContent(expected,"sheet-id",observation([row]),1)).toMatchObject({status:"conflict"});});
  it("업무 키 중복은 충돌이고 없는 행은 미실행 증명이 아니다",async()=>{expect(await verifyExternalContent(expected,"sheet-id",observation([actual,actual]),1)).toMatchObject({status:"conflict",reason:"duplicate-business-key"});expect(await verifyExternalContent(expected,"sheet-id",observation([]),1)).toMatchObject({status:"unknown",reason:"business-key-not-found"});});
  it("미리 채운 링크와 잘못된 열 계약을 거부한다",()=>{expect(()=>reportRowExpected.parse({...expected,values:actual})).toThrow();expect(()=>reportRowExpected.parse({...expected,values:values.slice(1)})).toThrow();});
});
