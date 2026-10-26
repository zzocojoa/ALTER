import { z } from "zod";
import { externalExpected,externalTargetReference,reportRowExpected } from "./verification.ts";
import type { ExternalExpected } from "./verification.ts";
import type { ExternalOperationRow } from "../../db/repositories/external-operation.ts";

const title=z.string().min(1).max(200);
const docBase=externalExpected.options[0];
const rowBase=externalExpected.options[2];
const eventBase=externalExpected.options[4];
const target=externalTargetReference;
export const googleExternalRequest=z.discriminatedUnion("kind",[
  z.object({kind:z.literal("document-create"),title,report:z.object({folder:target,businessKey:z.string().min(1).max(100)}).strict().optional()}).strict(),
  z.object({kind:z.literal("file-place"),target,parent:target,role:z.enum(["docs-target","sheets-target"]),businessKey:z.string().min(1).max(100)}).strict(),
  z.object({kind:z.literal("folder-verify"),target}).strict(),
  z.object({kind:z.literal("sheet-header-verify"),target,sheetName:title}).strict(),
  z.object({kind:z.literal("file-placement-verify"),target,parent:target,role:z.enum(["docs-target","sheets-target"]),businessKey:z.string().min(1).max(100)}).strict(),
  z.object({kind:z.literal("folder-create"),title,businessKey:z.string().min(1).max(100)}).strict(),
  z.object({kind:z.literal("sheet-header-write"),target,sheetName:title}).strict(),
  z.object({kind:z.literal("document-write"),target,base:docBase}).strict(),
  z.object({kind:z.literal("document-verify"),target}).strict(),
  z.object({kind:z.literal("sheet-create"),title}).strict(),
  z.object({kind:z.literal("report-row-append"),target,sheetName:z.literal("ALTER")}).strict(),
  z.object({kind:z.literal("report-row-update"),target,sheetName:z.literal("ALTER"),base:rowBase}).strict(),
  z.object({kind:z.literal("report-row-verify"),target,sheetName:z.literal("ALTER")}).strict(),
  z.object({kind:z.literal("sheet-row-append"),target,sheetName:title}).strict(),
  z.object({kind:z.literal("sheet-row-verify"),target,sheetName:title}).strict(),
  z.object({kind:z.literal("calendar-verify"),target}).strict(),
  z.object({kind:z.literal("calendar-create"),title}).strict(),
  z.object({kind:z.literal("calendar-event-create"),target}).strict(),
  z.object({kind:z.literal("calendar-event-update"),target,base:eventBase}).strict(),
  z.object({kind:z.literal("calendar-event-verify"),target}).strict(),
]);
export type GoogleExternalRequest=Readonly<z.infer<typeof googleExternalRequest>>;
export type GoogleExternalContract=Readonly<{request:GoogleExternalRequest;expected:ExternalExpected}>;
/** 보고서 필드 매핑은 호출자가 확정하며 어댑터는 서비스별 입력·기대 결과의 일치만 허용합니다. */
export function readGoogleExternalContract(row:ExternalOperationRow):GoogleExternalContract {
  const contract=z.object({request:googleExternalRequest,expected:externalExpected}).strict().parse(JSON.parse(row.snapshot));
  const {request,expected}=contract;
  const expectedKind:string=request.kind.startsWith("report-row-")?"report-row":["file-place","file-placement-verify"].includes(request.kind)?"file-placement":request.kind.startsWith("folder-")?"folder":request.kind.startsWith("sheet-header-")?"sheet-row":request.kind.startsWith("document-")?"document":request.kind==="sheet-create"?"sheet":request.kind.startsWith("sheet-row-")?"sheet-row":["calendar-create","calendar-verify"].includes(request.kind)?"calendar":"calendar-event";
  if(request.kind!==row.kind || expected.kind!==expectedKind) throw new TypeError("외부 단계의 서비스와 기대 결과 종류가 일치하지 않아요.");
  if((request.kind==="file-place" || request.kind==="file-placement-verify") && expected.kind==="file-placement" && (request.businessKey!==expected.businessKey || JSON.stringify(request.parent)!==JSON.stringify(expected.parent))) throw new TypeError("파일 배치 대상과 기대값이 다릅니다.");
  if(request.kind==="folder-create" && expected.kind==="folder" && request.businessKey!==expected.businessKey) throw new TypeError("폴더 생성 업무 키가 다릅니다.");
  if("title" in request && (!("title" in expected) || request.title!==expected.title)) throw new TypeError("생성 제목과 기대 결과가 다릅니다.");
  if(request.kind==="document-create" && expected.kind==="document" && expected.text!=="") throw new TypeError("문서 생성 단계는 빈 본문을 확인해야 합니다.");
  if(request.kind==="document-write" && expected.kind==="document" && (request.base.title!==expected.title || JSON.stringify(request.base.tab)!==JSON.stringify(expected.tab))) throw new TypeError("문서 쓰기의 대상 제목·탭이 바뀌었습니다.");
  if(expected.kind==="sheet-row" && expected.values[expected.keyColumn]!==expected.businessKey) throw new TypeError("성과표 업무 키 열이 일치하지 않아요.");
  if(expected.kind==="report-row") reportRowExpected.parse(expected);
  if(request.kind==="report-row-update" && expected.kind==="report-row" && (request.base.businessKey!==expected.businessKey || request.base.keyColumn!==0 || request.base.values.length!==10)) throw new TypeError("갱신 대상의 이전 업무 키·열 계약이 일치하지 않아요.");
  return contract;
}
export function googleManagedSheetRange(sheetName:string):string {title.parse(sheetName);return `'${sheetName.replaceAll("'","''")}'!A1:CV1000`;}
