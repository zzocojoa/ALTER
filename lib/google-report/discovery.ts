import { z } from "zod";
import { googleFileId } from "../google/resources.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { executeGoogleRestAttempt } from "../google/execute.ts";
import type { GoogleExecutionRuntime,GoogleExecutionSettings } from "../google/execute.ts";
import type { GoogleRestInput } from "../google/rest-request.ts";

const candidate=z.object({id:googleFileId,name:z.string(),mimeType:z.literal("application/vnd.google-apps.document"),trashed:z.literal(false),isAppAuthorized:z.literal(true),parents:z.array(googleFileId).length(1),appProperties:z.object({alterBusinessKey:z.string()})});
const searchPage=z.object({files:z.array(candidate).max(100),nextPageToken:z.string().min(1).max(2000).optional(),incompleteSearch:z.boolean().optional()});
export type GoogleReportSearch=Readonly<{state:"candidate"|"missing"|"conflict"|"incomplete";ids:readonly string[];pages:number}>;
export function inspectGoogleReportCandidates(pages:readonly unknown[],folderId:string,businessKey:string):GoogleReportSearch {
  googleFileId.parse(folderId);z.string().min(1).max(100).parse(businessKey);if(pages.length===0 || pages.length>10) throw new RangeError("보고서 검색 페이지 한도를 확인해 주세요.");
  const parsed=pages.map(page=>searchPage.parse(page));
  if(parsed.some(page=>page.files.some(file=>file.parents[0]!==folderId || file.appProperties.alterBusinessKey!==businessKey))) throw new TypeError("보고서 검색 범위와 파일의 업무 키가 다릅니다.");
  const ids:readonly string[]=[...new Set(parsed.flatMap(page=>page.files.map(file=>file.id)))];
  const incomplete:boolean=parsed.some(page=>page.incompleteSearch===true) || parsed.at(-1)?.nextPageToken!==undefined;
  return {state:ids.length>1?"conflict":incomplete?"incomplete":ids.length===1?"candidate":"missing",ids,pages:pages.length};
}
/** 승인된 전용 폴더의 업무 키로만 검색하며 미발견을 재생성 허가로 해석하지 않습니다. */
export async function searchGoogleReportDocument(db:D1Database,owner:SiteIdentity,settings:GoogleExecutionSettings,runtime:GoogleExecutionRuntime,folderId:string,businessKey:string):Promise<GoogleReportSearch> {
  return findGoogleReportDocument(folderId,businessKey,async input=>(await executeGoogleRestAttempt(db,owner,settings,input,{id:crypto.randomUUID(),role:"folder-target",storageUpperBytes:0,selection:null,context:null},runtime)).data);
}
export async function findGoogleReportDocument(folderId:string,businessKey:string,readPage:(input:Extract<GoogleRestInput,{method:"drive.files.list"}>)=>Promise<unknown>):Promise<GoogleReportSearch> {
  let pages:readonly unknown[]=[];let token:string|null=null;let tokens:readonly string[]=[];
  for(let page:number=0;page<10;page+=1) {
    const result=await readPage({method:"drive.files.list",parentId:folderId,businessKey,pageToken:token});
    const parsed=searchPage.parse(result);pages=[...pages,parsed];const found=inspectGoogleReportCandidates(pages,folderId,businessKey);
    if(found.state==="conflict" || !parsed.nextPageToken) return found;
    if(tokens.includes(parsed.nextPageToken)) throw new TypeError("Google 보고서 검색 페이지 토큰이 반복됐어요. 결과를 확정할 수 없습니다.");
    token=parsed.nextPageToken;tokens=[...tokens,token];
  }
  return inspectGoogleReportCandidates(pages,folderId,businessKey);
}
