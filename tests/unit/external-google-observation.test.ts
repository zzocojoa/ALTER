import { describe,expect,it } from "vitest";
import { readGoogleDocumentObservation,googleDocumentObservation,googleSheetRowsObservation,googleEventObservation } from "../../lib/external/google-observation.ts";
import { verifyExternalContent } from "../../lib/external/verification.ts";
import { prepareGoogleRestRequest } from "../../lib/google/rest-request.ts";

function tab(id:string,text:string):unknown {return {tabProperties:{tabId:id},documentTab:{body:{content:[{startIndex:1,endIndex:text.length+2,paragraph:{elements:[{textRun:{content:text+"\n"}}]}}]}}};}
const document={documentId:"doc",title:"title",revisionId:"revision",tabs:[tab("t.0","hello")]};
describe("Google 재조회 내용 범위",()=>{
  it("Docs의 전체 탭을 확인하고 구조를 생략한 성공을 허용하지 않는다",async()=>{
    expect(readGoogleDocumentObservation(document,{kind:"single-tab"})).toMatchObject({text:"hello",tabCount:1,bodyEndIndex:7});
    const multiple={...document,tabs:[...document.tabs,tab("t.1","hidden")]};
    const observation=googleDocumentObservation(readGoogleDocumentObservation(multiple,{kind:"single-tab"}));
    expect(await verifyExternalContent({kind:"document",title:"title",text:"hello",tab:{kind:"single-tab"}},"doc",observation,1)).toMatchObject({status:"conflict",reason:"tab-scope-mismatch"});
    expect(readGoogleDocumentObservation(multiple,{kind:"selected-tab",tabId:"t.1"}).text).toBe("hidden");
    expect(()=>readGoogleDocumentObservation({...document,tabs:[{tabProperties:{tabId:"t.0"},documentTab:{body:{content:[{endIndex:3,table:{}}]}}}]},{kind:"single-tab"})).toThrow();
    expect(()=>readGoogleDocumentObservation({body:{content:[]},revisionId:"revision"},{kind:"single-tab"})).toThrow();
  });
  it("Sheets 행 이동·중복·변경을 구분하고 다른 시트 범위를 거부한다",async()=>{
    const expected={kind:"sheet-row" as const,businessKey:"week-1",keyColumn:0,values:["week-1",3]};
    const moved=googleSheetRowsObservation({range:"ALTER!A1:CV1000",values:[["other",2],[],["week-1",3]]},"sheet","ALTER",1,1000);
    expect(await verifyExternalContent(expected,"sheet",moved,1)).toMatchObject({status:"matched",position:3});
    for(const [rows,reason] of [[[["week-1",3],["week-1",3]],"duplicate-business-key"],[[["week-1",4]],"content-mismatch"]] as const) expect(await verifyExternalContent(expected,"sheet",googleSheetRowsObservation({range:"ALTER!A1:CV1000",values:rows},"sheet","ALTER",1,1000),1)).toMatchObject({status:"conflict",reason});
    expect(()=>googleSheetRowsObservation({range:"OTHER!A1:CV1000",values:[]},"sheet","ALTER",1,1000)).toThrow();
  });
  it("기존 삽입으로 늘어난 마지막 빈 행도 조회하며 잘린 범위를 거부한다",async()=>{
    const request=await prepareGoogleRestRequest({method:"sheets.values.append",spreadsheetId:"sheet",range:"'ALTER'!A1:CV1000",values:[["key"]]},"sheets-target");
    expect(new URL(request.url).searchParams.get("insertDataOption")).toBe("OVERWRITE");
    expect(googleSheetRowsObservation({range:"ALTER!A1:CV1001",values:[["header"],["key"]]},"sheet","ALTER",1,1001).status).toBe("available");
    expect(()=>googleSheetRowsObservation({range:"ALTER!A1:CV1000",values:[]},"sheet","ALTER",1,1001)).toThrow();
    expect(()=>googleSheetRowsObservation({range:"ALTER!A1:CV1002",values:[]},"sheet","ALTER",1,1002)).toThrow();
  });
  it("Calendar 업무 키가 없거나 시간대가 다르면 내용을 임의 보완하지 않는다",()=>{
    expect(()=>googleEventObservation({id:"event"},"calendar")).toThrow();
  });
  it("문서 교체는 탭과 현재 revision을 지정하며 마지막 개행은 삭제하지 않는다",async()=>{
    const request=await prepareGoogleRestRequest({method:"docs.documents.batchUpdate",documentId:"doc",revisionId:"revision",tabId:"t.1",endIndex:7,text:"updated"},"docs-target");
    expect(JSON.parse(request.body??"{}")).toEqual({writeControl:{requiredRevisionId:"revision"},requests:[{deleteContentRange:{range:{startIndex:1,endIndex:6,tabId:"t.1"}}},{insertText:{location:{index:1,tabId:"t.1"},text:"updated"}}]});
    expect((await prepareGoogleRestRequest({method:"docs.documents.get",documentId:"doc"},"docs-target")).url).toContain("includeTabsContent=true");
  });
});
