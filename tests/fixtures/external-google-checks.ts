import { z } from "zod";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleQuota } from "./google-quota.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { executeGoogleRestAttempt } from "../../lib/google/execute.ts";
import type { GoogleExecutionSettings,GoogleExecutionRuntime } from "../../lib/google/execute.ts";
import { saveGoogleStorageObservation } from "../../db/repositories/google-observations.ts";
import { createExternalWorkflow } from "../../db/repositories/external-workflow.ts";
import { readExternalWorkflowView,resumeExternalWorkflow } from "../../lib/external/resume.ts";
import { googleExternalTransport } from "../../lib/external/google-adapter.ts";
import type { GoogleExternalRequest } from "../../lib/external/google-contract.ts";
import type { ExternalExpected } from "../../lib/external/verification.ts";
import type { ExternalOperationSeed } from "../../lib/external/creation.ts";
import type { ExternalExecutionRuntime } from "../../lib/external/execute.ts";

function ensure(value:boolean,label:string):void {if(!value) throw new Error(label);}
function operation(key:string,request:GoogleExternalRequest,expected:ExternalExpected):ExternalOperationSeed {
  return {stepKind:request.kind.startsWith("document")?"document":request.kind.startsWith("sheet")?"sheet":"calendar",kind:request.kind,businessKey:key,requestSnapshot:JSON.stringify(request),expectedSnapshot:JSON.stringify(expected),externalId:null};
}
export async function checkExternalGoogle(db:D1Database):Promise<readonly string[]> {
  let now:number=Date.parse("2026-10-25T02:00:00Z");const fixed=await fixtureGoogleConnection(db,"external-google-owner",now);
  const base=fixtureGoogleQuota(fixed.owner.userId,now,10000,10000);
  const quota=googleQuotaPolicy.parse({...base,apis:["drive","docs","sheets","calendar"].map(api=>({...base.apis[0],api,dimensions:base.apis[0].dimensions.map(d=>({...d,metric:"request-minute",unit:"requests",actions:["read","write","create"]}))})),methods:Object.entries(googleMethodPolicies).filter(([method])=>method!=="picker.open").map(([method,policy])=>({method,source:policy.source,costs:[{metric:"request-minute",scope:"project",units:1},{metric:"request-minute",scope:"user",units:1}]}))});
  const settings:GoogleExecutionSettings={credentials:{clientId:fixtureGoogleOAuth(now).clientId,clientSecret:"fixture-secret",keyring:fixed.keyring},project:{...fixtureGoogleProject(now),ownerId:fixed.owner.userId,projectId:quota.projectId,consoleSource:`https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}`},quota};
  let text:string="";let rows:readonly (readonly (string|number)[])[]=[];let event:unknown=null;const writes:Record<string,number>={};let calls:number=0;
  const runtime:GoogleExecutionRuntime={oauth:{fetch:async()=>{throw new Error("예상하지 않은 OAuth");},now:()=>now,wait:async()=>{throw new Error("OAuth 대기");},warn:()=>{}},rest:{now:()=>now,wait:async()=>{throw new Error("Worker 대기");},warn:()=>{},fetch:async(raw,init)=>{
    calls+=1;const url=new URL(raw);const path:string=url.pathname;const write:boolean=init.method!=="GET";
    if(write) writes[path]=(writes[path]??0)+1;
    if(path==="/drive/v3/about") return Response.json({storageQuota:{limit:"100000000",usage:"0"}});
    if(path.startsWith("/drive/v3/files/")) {const id:string=path.split("/").at(-1)??"";return Response.json({id,name:"fixed",mimeType:id==="fixed-doc"?"application/vnd.google-apps.document":"application/vnd.google-apps.spreadsheet",trashed:false,isAppAuthorized:true,capabilities:{canEdit:true},modifiedTime:new Date(now).toISOString()});}
    if(path==="/v1/documents") return Response.json({documentId:"fixed-doc"});
    if(path==="/v1/documents/fixed-doc") {ensure(url.searchParams.get("includeTabsContent")==="true","전체 탭 조회 누락");return Response.json({documentId:"fixed-doc",title:"fixed-report",revisionId:"r1",tabs:[{tabProperties:{tabId:"t.0"},documentTab:{body:{content:[{startIndex:1,endIndex:text.length+2,paragraph:{elements:[{textRun:{content:text+"\n"}}]}}]}}}]});}
    if(path==="/v1/documents/fixed-doc:batchUpdate") {const body=z.object({writeControl:z.object({requiredRevisionId:z.literal("r1")}),requests:z.array(z.object({insertText:z.object({text:z.string()}).optional()}))}).parse(JSON.parse(String(init.body)));text=body.requests.flatMap(request=>request.insertText?[request.insertText.text]:[]).join("");throw new TypeError("고정 시험: 본문 반영 후 응답 유실");}
    if(path==="/v4/spreadsheets") return Response.json({spreadsheetId:"fixed-sheet"});
    if(path==="/v4/spreadsheets/fixed-sheet") return Response.json({spreadsheetId:"fixed-sheet",properties:{title:"fixed-sheet"},sheets:[{properties:{title:"ALTER",gridProperties:{rowCount:1000,columnCount:100}}}]});
    if(path.includes("/values/")) {
      if(write){rows=[["moved-row",0],["week-key",1]];throw new TypeError("고정 시험: 행 추가 후 응답 유실");}
      return Response.json({range:"ALTER!A1:CV1000",majorDimension:"ROWS",values:rows});
    }
    if(path==="/calendar/v3/calendars") return Response.json({id:"fixed-calendar@group.calendar.google.com"});
    if(path.endsWith("/events")) {event={...z.record(z.unknown()).parse(JSON.parse(String(init.body))),etag:'"event-v1"'};throw new TypeError("고정 시험: 일정 생성 후 응답 유실");}
    if(path.includes("/events/")) return event===null?Response.json({error:{errors:[{reason:"notFound"}]}},{status:404}):Response.json(event);
    if(path.startsWith("/calendar/v3/calendars/")) return Response.json({id:"fixed-calendar@group.calendar.google.com",summary:"fixed-calendar",timeZone:"Asia/Seoul"});
    throw new Error("시험용 어댑터에 등록되지 않은 경로");
  }}};
  const probe=await executeGoogleRestAttempt(db,fixed.owner,settings,{method:"drive.about.get"},{id:crypto.randomUUID(),role:"account",storageUpperBytes:0,selection:null,context:null},runtime);
  await saveGoogleStorageObservation(db,fixed.owner,fixed.connection,probe.attemptId,quota.projectId,probe.data,now);
  const blank:ExternalExpected={kind:"document",title:"fixed-report",text:"",tab:{kind:"single-tab"}};
  const expectedEvent:ExternalExpected={kind:"calendar-event",eventId:"altertask15",businessKey:"event-fixed",summary:"fixed-event",description:"fixed-test",start:{dateTime:"2020-01-01T10:00:00+09:00",timeZone:"Asia/Seoul"},end:{dateTime:"2020-01-01T10:10:00+09:00",timeZone:"Asia/Seoul"},recurrence:["RRULE:FREQ=WEEKLY;COUNT=2"]};
  const job=await createExternalWorkflow(db,fixed.owner,"google-fixture",{jobId:null,kind:"calendar",targetKey:"google-fixture",sourceVersion:"v1",predecessorId:null,operations:[
    operation("create-doc",{kind:"document-create",title:"fixed-report"},blank),
    operation("write-doc",{kind:"document-write",target:{source:"operation",businessKey:"create-doc"},base:blank},{...blank,text:"fixed-confirmed-text"}),
    operation("create-sheet",{kind:"sheet-create",title:"fixed-sheet"},{kind:"sheet",title:"fixed-sheet"}),
    operation("append-row",{kind:"sheet-row-append",target:{source:"operation",businessKey:"create-sheet"},sheetName:"ALTER"},{kind:"sheet-row",businessKey:"week-key",keyColumn:0,values:["week-key",1]}),
    operation("create-calendar",{kind:"calendar-create",title:"fixed-calendar"},{kind:"calendar",title:"fixed-calendar",timeZone:"Asia/Seoul"}),
    operation("create-event",{kind:"calendar-event-create",target:{source:"operation",businessKey:"create-calendar"}},expectedEvent),
  ]},now);
  await db.prepare("CREATE TRIGGER external_google_create_save_failure BEFORE UPDATE OF state ON external_operations WHEN NEW.owner_id='external-google-owner' AND NEW.kind='sheet-create' AND NEW.state='received' BEGIN SELECT RAISE(ABORT,'injected_create_save_failure'); END").run();
  await db.prepare("CREATE TRIGGER external_google_resource_save_failure BEFORE INSERT ON google_resources WHEN NEW.owner_id='external-google-owner' AND NEW.role='docs-target' BEGIN SELECT RAISE(ABORT,'injected_resource_save_failure'); END").run();
  const execution:ExternalExecutionRuntime={now:()=>now,id:()=>crypto.randomUUID(),warn:()=>{},jitter:()=>0,requestBudgetMs:60_000};
  let failures:number=0;
  for(let request:number=0;request<20;request+=1) {
    const view=await readExternalWorkflowView(db,fixed.owner,job.id);if(view.state==="confirmed") break;
    const next=view.operations.find(item=>item.state!=="confirmed");if(!next) throw new Error("미완료 단계 없음");now=Math.max(now,next.nextAttemptAt);
    try {await resumeExternalWorkflow(db,fixed.owner,job.id,googleExternalTransport(db,fixed.owner,settings,runtime),execution);}
    catch(error:unknown) {
      if(!(error instanceof Error && "code" in error && ["external_unclassified_failure","google_rest_failed"].includes(String(error.code)))) throw error;
      failures+=1;
      if(next.kind==="document-create") await db.prepare("DROP TRIGGER external_google_resource_save_failure").run();
      if(next.kind==="sheet-create") await db.prepare("DROP TRIGGER external_google_create_save_failure").run();
    }
  }
  const final=await readExternalWorkflowView(db,fixed.owner,job.id);
  ensure(final.state==="confirmed" && failures===5,"서비스별 장애 복구 확인 실패");
  ensure(Object.values(writes).length===6 && Object.values(writes).every(value=>value===1),"장애 복구가 외부 쓰기를 중복 실행함");
  const before:number=calls;await resumeExternalWorkflow(db,fixed.owner,job.id,googleExternalTransport(db,fixed.owner,settings,runtime),execution);ensure(calls===before,"완료 재개에서 외부 호출");
  const audit=await db.prepare("SELECT count(*) AS n FROM google_requests WHERE owner_id=? AND sent_at IS NOT NULL").bind(fixed.owner.userId).first<{n:number}>();ensure(audit?.n===calls,"메타데이터·재조회·장애 요청의 quota 기록 누락");
  const rowProof=await db.prepare("SELECT verification FROM external_operations WHERE owner_id=? AND workflow_id=? AND kind='sheet-row-append'").bind(fixed.owner.userId,job.id).first<{verification:string}>();ensure(JSON.parse(rowProof?.verification??"{}").position===2,"이동된 행의 실제 위치 누락");
  return ["created-id-recovered-from-provider-receipt-after-db-failure","docs-body-loss-readback-no-second-insert","sheets-row-loss-moved-row-confirmed-no-second-append","calendar-event-loss-recurrence-and-key-readback","google-adapter-six-writes-once-and-all-requests-quota-recorded"];
}
