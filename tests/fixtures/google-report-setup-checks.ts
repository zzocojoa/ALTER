import { prepareGoogleReportWorkflow,readGoogleReportView,requireGoogleReportWorkflowCurrent } from "../../db/repositories/google-report-workflow.ts";
import { googleProjectEvidence } from "../../lib/google/project.ts";
import { readWeeklyWorkspace,setWeeklyTime } from "../../db/repositories/weekly-workspace.ts";
import { confirmWeeklyWorkspace } from "../../db/repositories/weekly-confirmation.ts";
import { readConfirmedGoogleReport } from "../../db/repositories/weekly-export.ts";
import { weeklyBusinessKey } from "../../lib/weekly/confirmation.ts";
import { prepareGoogleReportRowUpdate } from "../../lib/google-report/row.ts";
import { externalExpected,reportRowExpected } from "../../lib/external/verification.ts";
import { prepareGoogleReportRow } from "../../lib/google-report/row.ts";
import { googleWeeklyRow } from "../../lib/google-report/contract.ts";
import { readVerifiedGoogleReportDocument } from "../../db/repositories/google-report-document.ts";
import { prepareGoogleReportDocument } from "../../lib/google-report/document.ts";
import { googleWeeklyDocument } from "../../lib/google-report/contract.ts";
import type { ExternalDiagnostic } from "../../lib/external/diagnostic.ts";
import { searchGoogleReportDocument } from "../../lib/google-report/discovery.ts";
import { readGoogleReportTarget } from "../../db/repositories/google-report-target.ts";
import { z } from "zod";
import { recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import type { GoogleWeeklyReport } from "../../lib/google-report/contract.ts";
import { googleReportHeaders } from "../../lib/google-report/contract.ts";
import { prepareGoogleReportSetup } from "../../lib/google-report/setup.ts";
import { reserveGoogleReportSetup } from "../../db/repositories/google-report-setup.ts";
import { createExternalWorkflow } from "../../db/repositories/external-workflow.ts";
import { readExternalWorkflowView,resumeExternalWorkflow,recheckExternalWorkflowConflict } from "../../lib/external/resume.ts";
import { googleExternalTransport } from "../../lib/external/google-adapter.ts";
import { executeGoogleRestAttempt } from "../../lib/google/execute.ts";
import type { GoogleExecutionSettings,GoogleExecutionRuntime } from "../../lib/google/execute.ts";
import type { ExternalExecutionRuntime } from "../../lib/external/execute.ts";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { saveGoogleStorageObservation } from "../../db/repositories/google-observations.ts";
import { readGoogleResource } from "../../db/repositories/google-resources.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleQuota } from "./google-quota.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

function ensure(value:boolean,message:string):void {if(!value) throw new Error(message);}
async function denied(action:()=>Promise<unknown>,code:string):Promise<void> {try{await action();}catch(error:unknown){if(error instanceof Error && "code" in error && error.code===code) return;throw error;}throw new Error(`거부 누락: ${code}`);}
export async function checkGoogleReportSetup(db:D1Database,bucket:R2Bucket,owner:SiteIdentity,report:GoogleWeeklyReport):Promise<readonly string[]> {
  let now:number=Date.now();const fixed=await fixtureGoogleConnection(db,owner.userId,now);
  ensure((await readGoogleReportTarget(db,owner,report)).existingId===null,"없는 보고서 객체를 추측함");
  const reservations=await Promise.all([reserveGoogleReportSetup(db,owner,report,now),reserveGoogleReportSetup(db,owner,report,now)]);
  ensure(reservations[0].id===reservations[1].id,"동시 최초 설정 중복");const setup=reservations[0];
  await denied(()=>reserveGoogleReportSetup(db,owner,{...report,jobId:recordId.parse(crypto.randomUUID())},now),"result_unknown");
  const plan=prepareGoogleReportSetup(setup);const documentPlan=prepareGoogleReportDocument(report,plan.folder,null);const seed={jobId:report.jobId,kind:"weekly-export" as const,targetKey:report.businessKey,sourceVersion:report.versionId,predecessorId:null,operations:[...plan.operations,...documentPlan.operations,prepareGoogleReportRow(report,plan.sheet,documentPlan.target)]};
  await db.prepare("CREATE TRIGGER report_current_guard BEFORE INSERT ON atomic_requests WHEN NEW.scope='external.workflow.create' BEGIN UPDATE weekly_drafts SET content=json_set(content,'$.phase','draft') WHERE owner_id=NEW.owner_id; END").run();
  await denied(()=>createExternalWorkflow(db,owner,"stale-report-creation",seed,now),"version_conflict");await db.prepare("DROP TRIGGER report_current_guard").run();
  ensure((await readGoogleReportTarget(db,owner,report)).existingId===null,"최신 확정 검사 실패 후 부분 작업 생성");
  const prepared=await prepareGoogleReportWorkflow(db,bucket,owner,report.versionId,now);const job=prepared.workflow;if(job===null)throw new Error("보고서 준비 경로 누락");await requireGoogleReportWorkflowCurrent(db,bucket,owner,job.id);ensure((await createExternalWorkflow(db,owner,"report-setup-repeat",seed,now)).id===job.id,"설정 재요청 작업 중복");
  ensure((await readGoogleReportTarget(db,owner,report)).existingId===job.id,"보고서 업무 키 재사용 실패");
  await denied(()=>readGoogleReportTarget(db,owner,{...report,versionId:recordId.parse(crypto.randomUUID())}),"result_unknown");
  await denied(()=>readGoogleReportTarget(db,{realm:"sites",userId:"other-owner"},report),"reference_conflict");
  const contender=await createExternalWorkflow(db,owner,"report-shared-sheet-contender",{jobId:null,kind:"calendar",targetKey:"report-lock-test",sourceVersion:"v1",predecessorId:null,operations:[{stepKind:"sheet",kind:"sheet-row-append",businessKey:"contender",externalId:"report-sheet",requestSnapshot:JSON.stringify({kind:"sheet-row-append",target:{source:"known",externalId:"report-sheet"},sheetName:"ALTER"}),expectedSnapshot:JSON.stringify({kind:"sheet-row",businessKey:report.businessKey,keyColumn:0,values:[report.businessKey]})}]},now);
  const base=fixtureGoogleQuota(owner.userId,now,10000,10000);
  const quota=googleQuotaPolicy.parse({...base,apis:["drive","docs","sheets","calendar"].map(api=>({...base.apis[0],api,dimensions:base.apis[0].dimensions.map(d=>({...d,metric:"request-minute",unit:"requests",actions:["read","write","create"]}))})),methods:Object.entries(googleMethodPolicies).filter(([method])=>method!=="picker.open").map(([method,policy])=>({method,source:policy.source,costs:[{metric:"request-minute",scope:"project",units:1},{metric:"request-minute",scope:"user",units:1}]}))});
  const fixedProject=fixtureGoogleProject(now);const project=googleProjectEvidence.parse({...fixedProject,validUntil:now+3_600_000,apis:Object.fromEntries(Object.entries(fixedProject.apis).map(([api,proof])=>[api,{...proof,validUntil:now+3_600_000}]))});
  const settings:GoogleExecutionSettings={credentials:{clientId:fixtureGoogleOAuth(now).clientId,clientSecret:"fixed-secret",keyring:fixed.keyring},project:{...project,ownerId:owner.userId,projectId:quota.projectId,consoleSource:`https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}`},quota};
  let sheetMetadataReads:number=0;let rejectRevision:boolean=false;let raceSheetWrite:boolean=false;
  let documentText:string="";let documentParent:string="fixed-root";let documentKey:string="";let rows:readonly (readonly string[])[]=[];let parent:string="fixed-root";let sheetKey:string="";let folderKey:string="";let calls:number=0;const writes:Record<string,number>={};
  const runtime:GoogleExecutionRuntime={oauth:{fetch:async()=>{throw new Error("예상하지 않은 OAuth");},now:()=>now,wait:async()=>{throw new Error("대기 실행");},warn:()=>{}},rest:{now:()=>now,wait:async()=>{throw new Error("대기 실행");},warn:()=>{},fetch:async(raw,init)=>{
    calls+=1;const url=new URL(raw);const path=url.pathname;const write=init.method!=="GET";if(write) writes[path]=(writes[path]??0)+1;
    if(path==="/drive/v3/about") return Response.json({storageQuota:{limit:"100000000",usage:"0"}});
    if(path==="/drive/v3/files" && !write) return Response.json({files:[],...(url.searchParams.has("pageToken")?{}:{nextPageToken:"fixed-next"})});
    if(path==="/drive/v3/files") {folderKey=z.object({appProperties:z.object({alterBusinessKey:z.string()})}).parse(JSON.parse(String(init.body))).appProperties.alterBusinessKey;return Response.json({id:"report-folder"});}
    if(path.startsWith("/drive/v3/files/")) {
      const id=path.split("/").at(-1);if(id==="root")throw new Error("drive.file 범위를 넘는 루트 폴더 조회");if(id==="report-sheet" && !write){sheetMetadataReads+=1;if(sheetMetadataReads===2)return Response.json({error:{message:"시험 조회 실패",status:"NOT_FOUND"}},{status:404});}if(write){const key=z.object({appProperties:z.object({alterBusinessKey:z.string()})}).parse(JSON.parse(String(init.body))).appProperties.alterBusinessKey;if(id==="report-document"){documentParent=url.searchParams.get("addParents")??"missing";documentKey=key;}else{parent=url.searchParams.get("addParents")??"missing";sheetKey=key;}throw new TypeError("배치 반영 후 응답 유실");}
      return Response.json({id:id==="root"?"fixed-root":id,name:id==="report-folder"?"ALTER 학습 보고서":"ALTER 주간 성과",mimeType:id==="report-document"?"application/vnd.google-apps.document":id==="report-sheet"?"application/vnd.google-apps.spreadsheet":"application/vnd.google-apps.folder",trashed:false,isAppAuthorized:true,modifiedTime:new Date(now).toISOString(),capabilities:{canEdit:true},parents:[id==="report-document"?documentParent:parent],appProperties:{alterBusinessKey:id==="report-document"?documentKey:id==="report-folder"?folderKey:sheetKey}});
    }
    if(path==="/v1/documents") return Response.json({documentId:"report-document"});
    if(path==="/v1/documents/report-document") return Response.json({documentId:"report-document",title:report.title,revisionId:"fixed-revision",tabs:[{tabProperties:{tabId:"t.0"},documentTab:{body:{content:[{startIndex:1,endIndex:documentText.length+2,paragraph:{elements:[{textRun:{content:documentText+"\n"}}]}}]}}}]});
    if(path==="/v1/documents/report-document:batchUpdate") {if(rejectRevision) return Response.json({error:{status:"INVALID_ARGUMENT",message:"시험 revision 불일치"}},{status:400});const body=z.object({writeControl:z.object({requiredRevisionId:z.literal("fixed-revision")}),requests:z.array(z.object({insertText:z.object({text:z.string()}).optional()}))}).parse(JSON.parse(String(init.body)));documentText=body.requests.flatMap(item=>item.insertText?[item.insertText.text]:[]).join("");throw new TypeError("본문 반영 후 응답 유실");}
    if(path==="/v4/spreadsheets") return Response.json({spreadsheetId:"report-sheet"});
    if(path==="/v4/spreadsheets/report-sheet") return Response.json({spreadsheetId:"report-sheet",properties:{title:"ALTER 주간 성과"},sheets:[{properties:{title:"ALTER",gridProperties:{rowCount:1001,columnCount:100}}}]});
    if(path.includes("/values/")) {if(write){const values=z.object({values:z.array(z.array(z.string()))}).parse(JSON.parse(String(init.body))).values;
      if(path.endsWith(":append")){ensure(url.searchParams.get("insertDataOption")==="OVERWRITE","불필요한 시트 격자 행 삽입");ensure(decodeURIComponent(path).endsWith(`!A${rows.length+1}:J${rows.length+1}:append`),"빈 마지막 행 이외의 덮어쓰기 대상");ensure((await readVerifiedGoogleReportDocument(db,owner,report))?.documentId==="report-document","본문 검증 전 행 저장");rows=[rows[0],["사용자가 옮긴 다른 행"],[],...values];}else {const match=/!A(\d+):J\d+$/.exec(decodeURIComponent(path));if(!match) throw new Error("성과표 쓰기 범위 없음");const position=Number(match[1])-1;rows=position===0?values:rows.map((row,index)=>index===position?values[0]:row);}
      if(raceSheetWrite) rows=rows.map((row,index)=>index===3?row.map((cell,column)=>column===7?"조회 이후 동시 사용자 편집":cell):row);
      if(raceSheetWrite)return Response.json({spreadsheetId:"report-sheet",updatedRange:"ALTER!A4:J4"});
      throw new TypeError("성과표 반영 후 응답 유실");}return Response.json({range:"ALTER!A1:CV1001",majorDimension:"ROWS",values:rows});}
    throw new Error("예상하지 않은 Google 경로");
  }}};
  const probe=await executeGoogleRestAttempt(db,owner,settings,{method:"drive.about.get"},{id:crypto.randomUUID(),role:"account",storageUpperBytes:0,selection:null,context:null},runtime);await saveGoogleStorageObservation(db,owner,fixed.connection,probe.attemptId,quota.projectId,probe.data,now);
  await db.prepare("CREATE TRIGGER report_folder_stop BEFORE INSERT ON google_report_folders BEGIN SELECT RAISE(ABORT,'injected_folder_save'); END").run();
  await db.prepare("CREATE TRIGGER report_sheet_stop BEFORE UPDATE OF state ON external_operations WHEN NEW.kind='sheet-create' AND NEW.state='received' BEGIN SELECT RAISE(ABORT,'injected_sheet_save'); END").run();
  const diagnostics:ExternalDiagnostic[]=[];const execution:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),warn:entry=>{diagnostics.push(entry);},jitter:()=>0,requestBudgetMs:60_000};const transport=googleExternalTransport(db,owner,settings,runtime);let failures:number=0;
  const stored=await db.prepare("SELECT content FROM weekly_drafts WHERE owner_id=? AND summary_id=?").bind(owner.userId,report.summaryId).first<{content:string}>();if(!stored) throw new Error("확정 초안 없음");
  await db.prepare("UPDATE weekly_drafts SET content=json_set(content,'$.phase','draft') WHERE owner_id=? AND summary_id=?").bind(owner.userId,report.summaryId).run();const preflightCalls=calls;
  await denied(()=>resumeExternalWorkflow(db,owner,job.id,transport,execution),"reference_conflict");ensure(calls===preflightCalls,"오래된 확정본 실행 중 외부 호출");
  await db.prepare("UPDATE weekly_drafts SET content=? WHERE owner_id=? AND summary_id=?").bind(stored.content,owner.userId,report.summaryId).run();

  for(let index:number=0;index<32;index+=1) {
    const view=await readExternalWorkflowView(db,owner,job.id);if(view.state==="confirmed") break;const next=view.operations.find(item=>item.state!=="confirmed");if(!next) throw new Error("설정 단계 없음");now=Math.max(now,next.nextAttemptAt);
    try{await resumeExternalWorkflow(db,owner,job.id,transport,execution);}catch(error:unknown){if(!(error instanceof Error && "code" in error && ["external_unclassified_failure","google_rest_failed"].includes(String(error.code)))) throw error;failures+=1;if(next.kind==="folder-create") await db.prepare("DROP TRIGGER report_folder_stop").run();if(next.kind==="sheet-create") await db.prepare("DROP TRIGGER report_sheet_stop").run();if(next.kind==="sheet-header-write") {const beforeCalls=calls;now+=60_001;await denied(()=>resumeExternalWorkflow(db,owner,contender.id,transport,execution),"version_conflict");const pending=(await readExternalWorkflowView(db,owner,contender.id)).operations[0];ensure(pending.state==="pending" && pending.attemptCount===0 && beforeCalls===calls,"미확인 쓰기 직렬화 실패 또는 부분 선점");}}
  }
  ensure((await readExternalWorkflowView(db,owner,job.id)).state==="confirmed" && failures===8,"설정 중단 복구 실패");ensure(Object.keys(writes).length===8 && Object.values(writes).every(count=>count===1),"설정 중복 외부 쓰기");ensure(JSON.stringify(rows[0])===JSON.stringify(googleReportHeaders),"필수 헤더 불일치");
  const link=await readVerifiedGoogleReportDocument(db,owner,report);ensure(link?.documentId==="report-document" && documentText===googleWeeklyDocument(report),"검증된 문서 링크·본문 불일치");ensure(diagnostics.length===8,"실패 원인 기록 누락");
  ensure(JSON.stringify(rows[3])===JSON.stringify(googleWeeklyRow(report,"report-document")),"보고서 행·검증 문서 링크 불일치");
  const savedRow=(await readExternalWorkflowView(db,owner,job.id)).operations.find(item=>item.kind==="report-row-append");ensure(savedRow?.state==="confirmed","이동된 보고서 행 재조회 누락");
  await denied(()=>resumeExternalWorkflow(db,owner,contender.id,transport,execution),"external_content_conflict");
  ensure((await readExternalWorkflowView(db,owner,contender.id)).state==="conflict","확인 후 직렬화 잠금 재사용 실패");
  const ready=await reserveGoogleReportSetup(db,owner,report,now);ensure(ready.ready && ready.folderId==="report-folder" && ready.spreadsheetId==="report-sheet","설정 대상 재사용 실패");
  await denied(()=>readGoogleResource(db,{realm:"sites",userId:"other-owner"},fixed.connection,"report-folder","folder-target"),"google_scope_denied");
  const beforeDiscovery=calls;
  const discovery=await searchGoogleReportDocument(db,owner,settings,runtime,"report-folder",report.businessKey);ensure(discovery.state==="missing" && discovery.pages===2,"승인 폴더의 페이지네이션 확인 실패");
  const standaloneCalls:number=1+calls-beforeDiscovery;
  const priorWorkspace=await readWeeklyWorkspace(db,owner,report.summaryId);now+=1;
  await setWeeklyTime(db,bucket,{owner,requestKey:crypto.randomUUID(),expectedVersion:priorWorkspace.version},report.summaryId,5);
  const proposed=await readWeeklyWorkspace(db,owner,report.summaryId);
  await confirmWeeklyWorkspace(db,bucket,{owner,requestKey:crypto.randomUUID(),expectedVersion:proposed.version},{id:proposed.id,expectedVersion:proposed.version,businessKey:weeklyBusinessKey(proposed),fingerprint:proposed.fingerprint},now);
  const nextWorkspace=await readWeeklyWorkspace(db,owner,report.summaryId);if(!nextWorkspace.confirmedVersionId) throw new Error("새 확정판 없음");
  const nextReport=await readConfirmedGoogleReport(db,bucket,owner,nextWorkspace.confirmedVersionId);
  const nextTarget=await readGoogleReportTarget(db,owner,nextReport);if(!nextTarget.predecessor) throw new Error("이전 검증 대상 없음");
  ensure(nextTarget.predecessor.documentId==="report-document" && nextTarget.predecessor.spreadsheetId==="report-sheet","새 확정판 대상 연결 실패");
  const nextSetup=prepareGoogleReportSetup(await reserveGoogleReportSetup(db,owner,nextReport,now));const nextDocument=prepareGoogleReportDocument(nextReport,nextSetup.folder,nextTarget.predecessor);const nextRow=prepareGoogleReportRowUpdate(nextReport,nextDocument.target,nextTarget.predecessor);
  const nextPrepared=await prepareGoogleReportWorkflow(db,bucket,owner,nextReport.versionId,now);const nextJob=nextPrepared.workflow;if(nextJob===null)throw new Error("새 확정판 준비 경로 누락");
  for(let index:number=0;index<20;index+=1){const view=await readExternalWorkflowView(db,owner,nextJob.id);if(view.state==="confirmed") break;const next=view.operations.find(item=>item.state!=="confirmed");if(!next) throw new Error("새 판 단계 없음");now=Math.max(now,next.nextAttemptAt);try{await resumeExternalWorkflow(db,owner,nextJob.id,transport,execution);}catch(error:unknown){if(!(error instanceof Error && "code" in error && error.code==="google_rest_failed")) throw error;}}
  ensure((await readExternalWorkflowView(db,owner,nextJob.id)).state==="confirmed" && documentText===googleWeeklyDocument(nextReport) && JSON.stringify(rows[3])===JSON.stringify(googleWeeklyRow(nextReport,"report-document")),"새 확정판 같은 문서·행 갱신 실패");
  const completedCalls=calls;await resumeExternalWorkflow(db,owner,nextJob.id,transport,execution);ensure(completedCalls===calls && writes["/v1/documents"]===1 && writes["/v4/spreadsheets"]===1,"같은 확정판 또는 새 판이 생성 중복");
  await denied(()=>readConfirmedGoogleReport(db,bucket,owner,report.versionId),"version_conflict");
  const originalText=documentText;documentText="사용자가 직접 수정한 문서";
  const docConflict=await createExternalWorkflow(db,owner,"report-document-conflict",{jobId:null,kind:"calendar",targetKey:"report-document-conflict",sourceVersion:"v1",predecessorId:null,operations:[nextDocument.operations[1]]},now);
  const beforeDocWrites=writes["/v1/documents/report-document:batchUpdate"];await denied(()=>resumeExternalWorkflow(db,owner,docConflict.id,transport,execution),"external_content_conflict");ensure(documentText==="사용자가 직접 수정한 문서" && writes["/v1/documents/report-document:batchUpdate"]===beforeDocWrites,"사용자 문서 편집 덮어쓰기");documentText=originalText;
  const currentDocument=externalExpected.options[0].parse(JSON.parse(nextDocument.operations[1].expectedSnapshot));
  const currentRow=reportRowExpected.parse(JSON.parse(nextRow.expectedSnapshot));
  const rowConflictDocument=prepareGoogleReportDocument(nextReport,nextSetup.folder,{documentId:"report-document",document:currentDocument});
  const rowConflictPlan=prepareGoogleReportRowUpdate(nextReport,rowConflictDocument.target,{documentId:"report-document",spreadsheetId:"report-sheet",row:currentRow});
  const rowConflict=await createExternalWorkflow(db,owner,"report-row-user-conflict",{jobId:null,kind:"calendar",targetKey:"report-row-user-conflict",sourceVersion:"v1",predecessorId:null,operations:[rowConflictDocument.operations[1],rowConflictPlan]},now);
  await denied(()=>resumeExternalWorkflow(db,owner,rowConflict.id,transport,execution),"google_rest_failed");now+=1000;await resumeExternalWorkflow(db,owner,rowConflict.id,transport,execution);
  const correctRows=rows;rows=rows.map((row,index)=>index===3?row.map((cell,column)=>column===7?"사용자 직접 편집":cell):row);const beforeRowWrites=Object.values(writes).reduce((sum,count)=>sum+count,0);
  await denied(()=>resumeExternalWorkflow(db,owner,rowConflict.id,transport,execution),"external_content_conflict");ensure(rows[3][7]==="사용자 직접 편집" && beforeRowWrites===Object.values(writes).reduce((sum,count)=>sum+count,0),"사용자 성과 행 편집 덮어쓰기");rows=correctRows;
  const revisionPlan=prepareGoogleReportDocument({...nextReport,ordinal:nextReport.ordinal+1},nextSetup.folder,{documentId:"report-document",document:currentDocument});
  const revisionJob=await createExternalWorkflow(db,owner,"report-doc-revision-conflict",{jobId:null,kind:"calendar",targetKey:"report-doc-revision-conflict",sourceVersion:"v1",predecessorId:null,operations:[revisionPlan.operations[1]]},now);
  rejectRevision=true;await denied(()=>resumeExternalWorkflow(db,owner,revisionJob.id,transport,execution),"google_rest_failed");rejectRevision=false;
  await resumeExternalWorkflow(db,owner,revisionJob.id,transport,execution);ensure((await readExternalWorkflowView(db,owner,revisionJob.id)).state==="conflict" && documentText===originalText,"revision 거부를 완료 또는 덮어쓰기로 처리");
  const raceJob=await createExternalWorkflow(db,owner,"report-row-write-race",{jobId:null,kind:"calendar",targetKey:"report-row-write-race",sourceVersion:"v1",predecessorId:null,operations:[rowConflictDocument.operations[1],rowConflictPlan]},now);
  await denied(()=>resumeExternalWorkflow(db,owner,raceJob.id,transport,execution),"google_rest_failed");now+=1000;await resumeExternalWorkflow(db,owner,raceJob.id,transport,execution);
  raceSheetWrite=true;await resumeExternalWorkflow(db,owner,raceJob.id,transport,execution);raceSheetWrite=false;now+=1000;await resumeExternalWorkflow(db,owner,raceJob.id,transport,execution);
  ensure((await readExternalWorkflowView(db,owner,raceJob.id)).state==="conflict" && rows[3][7]==="조회 이후 동시 사용자 편집","조회와 쓰기 사이 사용자 편집 충돌 숨김");
  const recheckWrites=Object.values(writes).reduce((sum,count)=>sum+count,0);const recheckCalls=calls;
  await resumeExternalWorkflow(db,owner,raceJob.id,transport,execution);ensure(calls===recheckCalls,"충돌을 자동 재실행함");
  await recheckExternalWorkflowConflict(db,owner,raceJob.id,transport,execution);ensure((await readExternalWorkflowView(db,owner,raceJob.id)).state==="conflict","다른 실제 내용을 확인 완료로 처리");
  rows=correctRows;await recheckExternalWorkflowConflict(db,owner,raceJob.id,transport,execution);
  ensure((await readExternalWorkflowView(db,owner,raceJob.id)).state==="confirmed" && Object.values(writes).reduce((sum,count)=>sum+count,0)===recheckWrites,"재조회 중 쓰기 또는 내용 일치 확인 누락");
  await denied(()=>recheckExternalWorkflowConflict(db,owner,raceJob.id,transport,execution),"reference_conflict");
  const rejectedCalls=calls;await denied(()=>recheckExternalWorkflowConflict(db,owner,rowConflict.id,transport,execution),"result_unknown");ensure(calls===rejectedCalls,"성공 쓰기 응답 없는 충돌의 재조회 실행");
  const reportView=await readGoogleReportView(db,bucket,owner,nextReport.versionId);ensure(reportView.documentUrl?.includes("report-document")===true && reportView.spreadsheetUrl?.includes("report-sheet")===true,"검증된 보고서 링크 화면 누락");
  const reuse=await createExternalWorkflow(db,owner,"setup-reuse-fixture",{jobId:null,kind:"calendar",targetKey:"setup-reuse-fixture",sourceVersion:"v1",predecessorId:null,operations:[...prepareGoogleReportSetup(ready).operations]},now);
  rows=[["사용자가 변경한 헤더",...googleReportHeaders.slice(1)]];const writeCount=Object.values(writes).reduce((sum,count)=>sum+count,0);
  await resumeExternalWorkflow(db,owner,reuse.id,transport,execution);await resumeExternalWorkflow(db,owner,reuse.id,transport,execution);await denied(()=>resumeExternalWorkflow(db,owner,reuse.id,transport,execution),"external_content_conflict");
  ensure((await readExternalWorkflowView(db,owner,reuse.id)).state==="conflict" && Object.values(writes).reduce((sum,count)=>sum+count,0)===writeCount,"변경된 헤더 덮어쓰기");
  ensure((await db.prepare("SELECT count(*) AS n FROM google_requests WHERE owner_id=? AND sent_at IS NOT NULL").bind(owner.userId).first<{n:number}>())?.n===calls,"설정·검증·복구 메서드 기록 누락");
  const contextCount=await db.prepare("SELECT count(*) AS n FROM external_google_requests c JOIN google_requests q ON q.owner_id=c.owner_id AND q.id=c.id WHERE c.owner_id=? AND q.sent_at IS NOT NULL").bind(owner.userId).first<{n:number}>();ensure(contextCount?.n===calls-standaloneCalls,"보조 메타데이터·복구 요청의 외부 단계 연결 누락");
  const batch=await db.prepare("SELECT count(*) AS n,sum(c.batch_subrequests) AS subrequests FROM external_google_requests c JOIN google_requests q ON q.owner_id=c.owner_id AND q.id=c.id WHERE c.owner_id=? AND q.method='docs.documents.batchUpdate' AND q.sent_at IS NOT NULL").bind(owner.userId).first<{n:number;subrequests:number}>();ensure(batch!==null && batch.n===writes["/v1/documents/report-document:batchUpdate"] && batch.subrequests>batch.n,"batch 내부 요청과 HTTP 요청 수 혼동");
  return ["report-existing-1001-row-grid-full-read-without-insertion","report-conflict-explicit-read-only-recheck-preserves-writes-and-expectation","report-root-query-removed-and-preflight-no-write-proven-recovery","report-current-version-guard-rolls-back-creation-and-stops-network","report-folder-search-pages-counted-missing-not-recreated","report-business-key-existing-job-and-unconfirmed-version-block","report-setup-concurrent-reservation-one-initializer","report-setup-other-report-cannot-bypass-incomplete-creation","report-folder-and-sheet-save-interruption-recovers-provider-ids","report-placement-and-header-loss-readback-no-duplicate-write","report-setup-docs-sheet-eight-writes-once-all-network-quota-recorded","report-docs-body-loss-verified-on-read-without-duplicate-text","report-row-response-loss-moved-row-verified-doc-link-no-duplicate","report-setup-existing-resources-reused-other-owner-rejected","report-header-user-edit-conflict-with-zero-overwrite","report-new-confirmed-version-same-doc-and-moved-row","report-docs-and-sheets-user-edits-stop-before-write","report-sheet-serialization-survives-expiry-and-rolls-back-contender","report-docs-revision-rejection-never-repeated-or-confirmed","report-sheets-write-race-detected-by-readback","report-all-auxiliary-reads-attributed-to-attempt","report-batch-subrequests-separated-from-http-quota"];
}
