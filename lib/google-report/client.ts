import { z } from "zod";
import { externalWorkflowState, externalOperationState } from "../external/state";
import { advanceExternalWorkflow } from "../external/client";
export const googleReportViewReply=z.object({versionId:z.string().uuid(),connected:z.boolean(),workflow:z.object({id:z.string().uuid(),state:externalWorkflowState,operations:z.array(z.object({kind:z.string(),state:externalOperationState}))}).nullable(),documentUrl:z.string().regex(/^https:\/\/docs\.google\.com\/document\/d\/[A-Za-z0-9_-]{1,200}\/edit$/).nullable(),spreadsheetUrl:z.string().regex(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{1,200}\/edit$/).nullable()});
export type GoogleReportClientView=z.infer<typeof googleReportViewReply>;
async function reportResponse(response:Response,versionId:string):Promise<GoogleReportClientView> {
  const httpMessage:string=`보고서 상태를 확인하지 못했어요. (HTTP ${response.status})`;
  let data:unknown;
  try {data=await response.json();}
  catch (cause:unknown) {
    if(response.ok)throw cause;
    throw Object.assign(new Error(httpMessage,{cause}),{status:response.status});
  }
  if(!response.ok){const error=z.object({message:z.string()}).safeParse(data);throw Object.assign(new Error(error.success?error.data.message:httpMessage),{status:response.status});}const view=googleReportViewReply.parse(data);if(view.versionId!==versionId)throw new Error("요청한 주간 확정본과 Google 연동 응답이 달라요. 상태를 다시 확인해 주세요.");return view;
}
export async function loadGoogleReportView(versionId:string):Promise<GoogleReportClientView> {z.string().uuid().parse(versionId);return reportResponse(await fetch(`/api/google/reports?versionId=${encodeURIComponent(versionId)}`,{cache:"no-store"}),versionId);}
export async function sendGoogleWeeklyReport(versionId:string,onProgress:(message:string)=>void):Promise<void> {
  z.string().uuid().parse(versionId);const view=await reportResponse(await fetch("/api/google/reports",{method:"POST",cache:"no-store",headers:{"content-type":"application/json"},body:JSON.stringify({versionId})}),versionId);
  if(!view.connected){onProgress("내부 확정본을 보관했어요. Google을 연결한 뒤 내보내기를 이어갈 수 있어요.");return;}
  if(view.workflow===null)throw new Error("보고서 실행 작업이 없어요. 저장 상태를 확인해 주세요.");
  await advanceExternalWorkflow(view.workflow.id,onProgress);onProgress("Docs 본문과 Sheets 행·링크를 다시 읽어 확인했어요.");
}
