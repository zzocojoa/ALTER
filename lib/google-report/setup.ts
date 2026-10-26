import { z } from "zod";
import { recordId } from "../domain/contracts.ts";
import { googleFileId } from "../google/resources.ts";
import type { ExternalOperationSeed } from "../external/creation.ts";
import type { ExternalTargetReference } from "../external/verification.ts";
import { googleReportHeaders } from "./contract.ts";

export const googleReportSetup=z.object({id:recordId,jobId:recordId,folderId:googleFileId.nullable(),spreadsheetId:googleFileId.nullable(),ready:z.boolean()}).strict();
export type GoogleReportSetup=Readonly<z.infer<typeof googleReportSetup>>;
export type GoogleReportSetupPlan=Readonly<{folder:ExternalTargetReference;sheet:ExternalTargetReference;operations:readonly ExternalOperationSeed[]}>;
/** 최초 설정은 첫 확정 보고서 작업에 포함하며 이후 보고서는 확인된 동일 대상을 재사용합니다. */
export function prepareGoogleReportSetup(value:GoogleReportSetup):GoogleReportSetupPlan {
  const setup=googleReportSetup.parse(value);const folderKey:string=`setup:${setup.id}:folder`;const sheetKey:string=`setup:${setup.id}:sheet`;
  if(setup.ready) {
    if(!setup.folderId || !setup.spreadsheetId) throw new TypeError("확인된 Google 보고서 대상 ID가 없습니다.");
    return {folder:{source:"known",externalId:setup.folderId},sheet:{source:"known",externalId:setup.spreadsheetId},operations:[
      {stepKind:"google-docs-weekly-report",kind:"folder-verify",businessKey:folderKey,externalId:setup.folderId,requestSnapshot:JSON.stringify({kind:"folder-verify",target:{source:"known",externalId:setup.folderId}}),expectedSnapshot:JSON.stringify({kind:"folder",title:"ALTER 학습 보고서",businessKey:folderKey})},
      {stepKind:"google-sheets-weekly-row",kind:"file-placement-verify",businessKey:`setup:${setup.id}:sheet-folder`,externalId:setup.spreadsheetId,requestSnapshot:JSON.stringify({kind:"file-placement-verify",target:{source:"known",externalId:setup.spreadsheetId},parent:{source:"known",externalId:setup.folderId},role:"sheets-target",businessKey:sheetKey}),expectedSnapshot:JSON.stringify({kind:"file-placement",parent:{source:"known",externalId:setup.folderId},businessKey:sheetKey})},
      {stepKind:"google-sheets-weekly-row",kind:"sheet-header-verify",businessKey:`setup:${setup.id}:header`,externalId:setup.spreadsheetId,requestSnapshot:JSON.stringify({kind:"sheet-header-verify",target:{source:"known",externalId:setup.spreadsheetId},sheetName:"ALTER"}),expectedSnapshot:JSON.stringify({kind:"sheet-row",businessKey:googleReportHeaders[0],keyColumn:0,values:googleReportHeaders})},
    ]};
  }
  return {folder:{source:"operation",businessKey:folderKey},sheet:{source:"operation",businessKey:sheetKey},operations:[
    {stepKind:"google-docs-weekly-report",kind:"folder-create",businessKey:folderKey,externalId:null,requestSnapshot:JSON.stringify({kind:"folder-create",title:"ALTER 학습 보고서",businessKey:folderKey}),expectedSnapshot:JSON.stringify({kind:"folder",title:"ALTER 학습 보고서",businessKey:folderKey})},
    {stepKind:"google-sheets-weekly-row",kind:"sheet-create",businessKey:sheetKey,externalId:null,requestSnapshot:JSON.stringify({kind:"sheet-create",title:"ALTER 주간 성과"}),expectedSnapshot:JSON.stringify({kind:"sheet",title:"ALTER 주간 성과"})},
    {stepKind:"google-sheets-weekly-row",kind:"file-place",businessKey:`setup:${setup.id}:sheet-folder`,externalId:null,requestSnapshot:JSON.stringify({kind:"file-place",target:{source:"operation",businessKey:sheetKey},parent:{source:"operation",businessKey:folderKey},role:"sheets-target",businessKey:sheetKey}),expectedSnapshot:JSON.stringify({kind:"file-placement",parent:{source:"operation",businessKey:folderKey},businessKey:sheetKey})},
    {stepKind:"google-sheets-weekly-row",kind:"sheet-header-write",businessKey:`setup:${setup.id}:header`,externalId:null,requestSnapshot:JSON.stringify({kind:"sheet-header-write",target:{source:"operation",businessKey:sheetKey},sheetName:"ALTER"}),expectedSnapshot:JSON.stringify({kind:"sheet-row",businessKey:googleReportHeaders[0],keyColumn:0,values:googleReportHeaders})},
  ]};
}
