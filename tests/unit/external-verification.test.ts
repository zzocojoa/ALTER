import { describe, expect, it } from "vitest";
import { verifyExternalContent } from "../../lib/external/verification.ts";
import type { ExternalExpected } from "../../lib/external/verification.ts";

const document: ExternalExpected = {kind:"document",title:"고정 보고서",text:"확정 내용\n",tab:{kind:"single-tab"}};
const event: ExternalExpected = {kind:"calendar-event",eventId:"alter123",businessKey:"weekly-review",summary:"주간 복습",description:"확정 일정",start:{dateTime:"2026-10-26T10:00:00+09:00",timeZone:"Asia/Seoul"},end:{dateTime:"2026-10-26T10:20:00+09:00",timeZone:"Asia/Seoul"},recurrence:["RRULE:FREQ=WEEKLY;BYDAY=MO"]};
describe("외부 재조회 내용 검증", () => {
  it("본문 일부 누락·사용자 수정·다른 대상·숨은 탭을 성공으로 처리하지 않는다", async () => {
    const content = {kind:"document" as const,title:document.title,text:document.text,tabId:"t.0",documentTabCount:1};
    expect((await verifyExternalContent(document,"doc-1",{status:"available",externalId:"doc-1",content},1)).status).toBe("matched");
    expect((await verifyExternalContent(document,"doc-1",{status:"available",externalId:"doc-1",content:{...content,text:"확정"}},1)).status).toBe("conflict");
    expect((await verifyExternalContent(document,"doc-1",{status:"available",externalId:"doc-2",content},1)).status).toBe("conflict");
    expect((await verifyExternalContent(document,"doc-1",{status:"available",externalId:"doc-1",content:{...content,documentTabCount:2}},1)).status).toBe("conflict");
  });
  it("대상 미발견·검색 지연·조회 장애는 미실행으로 바꾸지 않는다", async () => {
    for (const reason of ["not-found","incomplete-search","request-failed","missing-external-id"] as const) expect((await verifyExternalContent(document,"doc-1",{status:"unavailable",reason},1)).status).toBe("unknown");
  });
  it("행 이동은 업무 키로 찾고 동일 키 중복과 직접 수정은 충돌로 남긴다", async () => {
    const expected: ExternalExpected = {kind:"sheet-row",businessKey:"week-1",keyColumn:0,values:["week-1","report-link",3,""]};
    const content = {kind:"sheet-rows" as const,startRow:2,rows:[["other"],["week-1","report-link",3]]};
    const matched = await verifyExternalContent(expected,"sheet",{status:"available",externalId:"sheet",content},1);
    expect(matched.status).toBe("matched"); if(matched.status === "matched") expect(matched.position).toBe(3);
    expect((await verifyExternalContent(expected,"sheet",{status:"available",externalId:"sheet",content:{...content,rows:[...content.rows,["week-1","report-link",3]]}},1)).status).toBe("conflict");
    expect((await verifyExternalContent(expected,"sheet",{status:"available",externalId:"sheet",content:{...content,rows:[["week-1","changed",3]]}},1)).status).toBe("conflict");
    expect((await verifyExternalContent(expected,"sheet",{status:"available",externalId:"sheet",content:{...content,rows:[]}},1)).status).toBe("unknown");
  });
  it("일정의 업무 키·시각·반복 규칙은 모두 일치해야 한다", async () => {
    const content = {...event,recurrence:["RRULE:BYDAY=MO;FREQ=WEEKLY"],start:{...event.start,dateTime:"2026-10-26T01:00:00Z"}};
    expect((await verifyExternalContent(event,"calendar",{status:"available",externalId:"calendar",content},1)).status).toBe("matched");
    expect((await verifyExternalContent(event,"calendar",{status:"available",externalId:"calendar",content:{...content,businessKey:"other"}},1)).status).toBe("conflict");
    expect((await verifyExternalContent(event,"calendar",{status:"available",externalId:"calendar",content:{...content,recurrence:[]}},1)).status).toBe("conflict");
  });
});
