import { z } from "zod";
import { googleFileId } from "../google/resources.ts";
import { googleWeeklyReport,googleWeeklyDocument } from "./contract.ts";
import type { GoogleWeeklyReport } from "./contract.ts";
import { externalExpected,externalTargetReference } from "../external/verification.ts";
import type { ExternalExpected,ExternalTargetReference } from "../external/verification.ts";
import type { ExternalOperationSeed } from "../external/creation.ts";

export type GoogleDocumentPredecessor=Readonly<{documentId:string;document:Extract<ExternalExpected,{kind:"document"}>}>;
export type GoogleReportDocumentPlan=Readonly<{target:ExternalTargetReference;operations:readonly ExternalOperationSeed[]}>;
/** 같은 주간의 문서는 재사용하고 이전 검증 본문이 일치할 때만 새 확정판으로 교체합니다. */
export function prepareGoogleReportDocument(value:GoogleWeeklyReport,folder:ExternalTargetReference,previous:GoogleDocumentPredecessor|null):GoogleReportDocumentPlan {
  const report=googleWeeklyReport.parse(value);externalTargetReference.parse(folder);
  const createKey:string=`report:${report.businessKey}:document-create`;const writeKey:string=`report:${report.businessKey}:document-write`;
  const expected:Extract<ExternalExpected,{kind:"document"}>={kind:"document",title:report.title,text:googleWeeklyDocument(report),tab:{kind:"single-tab"}};
  const base=previous===null?{...expected,text:""}:externalExpected.options[0].parse(previous.document);
  if(previous!==null){googleFileId.parse(previous.documentId);if(base.title!==report.title || base.tab.kind!=="single-tab") throw new TypeError("이전 주간 문서의 제목·탭 계약이 달라요.");}
  const target:ExternalTargetReference=previous===null?{source:"operation",businessKey:createKey}:{source:"known",externalId:previous.documentId};
  const placementKind=previous===null?"file-place":"file-placement-verify";
  const externalId:string|null=previous?.documentId??null;
  const created:readonly ExternalOperationSeed[]=previous===null?[{stepKind:"google-docs-weekly-report",kind:"document-create",businessKey:createKey,externalId:null,requestSnapshot:JSON.stringify({kind:"document-create",title:report.title,report:{folder,businessKey:report.businessKey}}),expectedSnapshot:JSON.stringify(base)}]:[];
  return {target:{source:"operation",businessKey:writeKey},operations:[...created,
    {stepKind:"google-docs-weekly-report",kind:placementKind,businessKey:`report:${report.businessKey}:document-folder`,externalId,requestSnapshot:JSON.stringify({kind:placementKind,target,parent:folder,role:"docs-target",businessKey:report.businessKey}),expectedSnapshot:JSON.stringify({kind:"file-placement",parent:folder,businessKey:report.businessKey})},
    {stepKind:"google-docs-weekly-report",kind:"document-write",businessKey:writeKey,externalId,requestSnapshot:JSON.stringify({kind:"document-write",target,base}),expectedSnapshot:JSON.stringify(expected)},
  ]};
}
export function googleReportDocumentUrl(documentId:string):string {return `https://docs.google.com/document/d/${googleFileId.parse(documentId)}/edit`;}
export const googleDocumentLink=z.object({documentId:googleFileId,url:z.string().url(),verified:z.literal(true)}).strict();
export type GoogleDocumentLink=Readonly<z.infer<typeof googleDocumentLink>>;
