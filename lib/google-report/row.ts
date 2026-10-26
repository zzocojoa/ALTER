import { googleWeeklyReport,googleWeeklyRowTemplate } from "./contract.ts";
import type { GoogleWeeklyReport } from "./contract.ts";
import { externalTargetReference,reportRowExpected,externalExpected } from "../external/verification.ts";
import { googleReportDocumentUrl } from "./document.ts";
import type { ExternalExpected,ExternalTargetReference } from "../external/verification.ts";
import type { ExternalOperationSeed } from "../external/creation.ts";

/** 본문 검증 단계의 참조를 고정하여 생성 ID를 미리 추측하지 않습니다. */
export function prepareGoogleReportRow(value:GoogleWeeklyReport,sheet:ExternalTargetReference,document:ExternalTargetReference):ExternalOperationSeed {
  const report=googleWeeklyReport.parse(value);externalTargetReference.parse(sheet);externalTargetReference.parse(document);
  if(document.source!=="operation") throw new TypeError("같은 작업의 본문 검증 단계를 참조해야 합니다.");
  const expected=reportRowExpected.parse({kind:"report-row",businessKey:report.businessKey,document,values:googleWeeklyRowTemplate(report)});
  return {stepKind:"google-sheets-weekly-row",kind:"report-row-append",businessKey:`report:${report.businessKey}:row`,externalId:sheet.source==="known"?sheet.externalId:null,requestSnapshot:JSON.stringify({kind:"report-row-append",target:sheet,sheetName:"ALTER"}),expectedSnapshot:JSON.stringify(expected)};
}

export type GoogleRowPredecessor=Readonly<{spreadsheetId:string;documentId:string;row:Extract<ExternalExpected,{kind:"report-row"}>}>;
/** 행 번호는 저장하지 않고 마지막 검증 값과 실제 문서 링크로 사전 비교합니다. */
export function prepareGoogleReportRowUpdate(value:GoogleWeeklyReport,document:ExternalTargetReference,previous:GoogleRowPredecessor):ExternalOperationSeed {
  const report=googleWeeklyReport.parse(value);const prior=reportRowExpected.parse(previous.row);const sheet:ExternalTargetReference={source:"known",externalId:previous.spreadsheetId};
  if(prior.businessKey!==report.businessKey) throw new TypeError("다른 주간 성과 행은 갱신할 수 없어요.");
  const base=externalExpected.options[2].parse({kind:"sheet-row",businessKey:prior.businessKey,keyColumn:0,values:prior.values.map((value,index)=>index===8?googleReportDocumentUrl(previous.documentId):value)});
  const prepared=prepareGoogleReportRow(report,sheet,document);
  return {...prepared,kind:"report-row-update",requestSnapshot:JSON.stringify({kind:"report-row-update",target:sheet,sheetName:"ALTER",base})};
}
