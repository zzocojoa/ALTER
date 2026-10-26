import { z } from "zod";
import { recordId,version,domainFailure } from "../domain/contracts.ts";
import { addCalendarDays } from "../reviews/calendar.ts";
import { weeklyBusinessKey,weeklyExportContent } from "../weekly/confirmation.ts";
import { weeklyWorkspace } from "../weekly/workspace.ts";
import type { WeeklyWorkspace } from "../weekly/workspace.ts";
import type { WeeklyClaimKind } from "../weekly/claims.ts";
import { weeklyContent } from "../../db/repositories/weekly.ts";

const field=z.string().min(1).max(50_000);
export const googleWeeklyReport=z.object({versionId:recordId,jobId:recordId,summaryId:recordId,ordinal:version,businessKey:z.string().min(1).max(200),period:field,units:field,independent:field,helped:field,errors:field,content:weeklyContent,title:z.string().min(1).max(200)}).strict();
export type GoogleWeeklyReport=Readonly<z.infer<typeof googleWeeklyReport>>;
export const googleReportHeaders:readonly string[]=["ALTER 업무 키","확정 버전","학습 기간","단원","독립 수행","도움받은 부분","주요 오답","다음 행동","보고서 링크","ALTER 확정본 ID"];
function selectedClaimText(state:WeeklyWorkspace,kinds:readonly WeeklyClaimKind[],empty:string):string {
  const texts:readonly string[]=state.claims.filter(claim=>kinds.includes(claim.kind)).map(claim=>claim.content);
  return texts.length>0?texts.join("\n"):empty;
}
/** 확정 당시 허용 필드만 매핑하며 대화·답안·개인 메모·원문은 전달하지 않습니다. */
export function prepareGoogleWeeklyReport(value:WeeklyWorkspace,jobId:string):GoogleWeeklyReport {
  const state:WeeklyWorkspace=weeklyWorkspace.parse(value);recordId.parse(jobId);
  if(state.phase!=="confirmed" || !state.confirmedVersionId) throw domainFailure("version_conflict","google-report.confirmed-version-required",{id:state.id});
  const content=weeklyExportContent(state);const period=state.context.aggregate.period;
  const helped:readonly string[]=state.context.aggregate.answers.filter(answer=>answer.helped).map(answer=>`${answer.unitTitle}: 도움 사용 답안 · 기록 ${answer.helpIds.length}건`);
  const units:readonly string[]=[...new Set(state.context.aggregate.answers.map(answer=>answer.unitTitle))];
  return googleWeeklyReport.parse({versionId:state.confirmedVersionId,jobId,summaryId:state.id,ordinal:state.version,businessKey:weeklyBusinessKey(state),period:`${period.start} ~ ${addCalendarDays(period.start,6)} (Asia/Seoul)`,units:units.length?units.join("\n"):"확정한 학습 답안 없음",independent:selectedClaimText(state,["independent-new-condition","independent-explanation","correction-recheck","delayed-recall"],"선택한 독립 수행 근거 없음"),helped:helped.length?helped.join("\n"):"확정 답안에 도움 사용 기록 없음",errors:selectedClaimText(state,["incorrect-answer"],"선택한 확정 오답 근거 없음"),content,title:`ALTER 주간 보고서 · ${period.start}`});
}
export function googleWeeklyDocument(report:GoogleWeeklyReport):string {
  const value=googleWeeklyReport.parse(report);
  return z.string().max(200_000).parse([value.title,`업무 키: ${value.businessKey}`,`확정본: ${value.versionId} · ${value.ordinal}판`,value.period,"단원",value.units,"독립 수행",value.independent,"도움받은 부분",value.helped,"주요 오답",value.errors,"성과",value.content.achievements,"어려움",value.content.difficulties,"개선",value.content.improvements,"다음 행동",value.content.nextActions].join("\n\n"));
}
function rowFields(report:GoogleWeeklyReport,link:string):readonly string[] {
  const value=googleWeeklyReport.parse(report);
  return [value.businessKey,String(value.ordinal),value.period,value.units,value.independent,value.helped,value.errors,value.content.nextActions,link,value.versionId];
}
export function googleWeeklyRow(report:GoogleWeeklyReport,documentId:string):readonly string[] {
  z.string().regex(/^[A-Za-z0-9_-]{1,200}$/).parse(documentId);
  return rowFields(report,`https://docs.google.com/document/d/${documentId}/edit`);
}
/** 문서 ID는 생성 응답 대신 앞선 본문 검증 단계가 확정된 후 채웁니다. */
export function googleWeeklyRowTemplate(report:GoogleWeeklyReport):readonly string[] {return rowFields(report,"");}
