import { z } from "zod";
import type { ExternalExpected,ExternalObservation } from "./verification.ts";

const id=z.string().min(1).max(1024);
const paragraph=z.object({elements:z.array(z.object({textRun:z.object({content:z.string()}),startIndex:z.number().int().optional(),endIndex:z.number().int().optional()}).passthrough()).max(10000)}).passthrough();
const element=z.object({startIndex:z.number().int().optional(),endIndex:z.number().int().nonnegative(),sectionBreak:z.object({}).passthrough().optional(),paragraph:paragraph.optional()}).passthrough().refine(value=>(value.paragraph!==undefined || value.sectionBreak!==undefined) && !("table" in value) && !("tableOfContents" in value));
const documentTab=z.object({tabProperties:z.object({tabId:id}),documentTab:z.object({body:z.object({content:z.array(element).max(10000)})}),childTabs:z.array(z.unknown()).max(100).optional()});
export type GoogleDocumentObservation=Readonly<{documentId:string;title:string;revisionId:string;tabId:string;tabCount:number;text:string;bodyEndIndex:number}>;
function flattenTabs(values:readonly unknown[],depth:number):readonly z.infer<typeof documentTab>[] {
  if(depth>10) throw new RangeError("문서 탭 중첩 한도를 초과했어요.");
  const tabs=values.flatMap(value=>{const tab=documentTab.parse(value);return [tab,...flattenTabs(tab.childTabs??[],depth+1)];});
  if(tabs.length>100) throw new RangeError("문서 탭 수 한도를 초과했어요.");return tabs;
}
/** 전체 탭 응답에서 지정 탭을 고르며 표·이미지 등 판독하지 않은 내용을 빈 문자열로 생략하지 않습니다. */
export function readGoogleDocumentObservation(value:unknown,scope:Extract<ExternalExpected,{kind:"document"}>["tab"]):GoogleDocumentObservation {
  const doc=z.object({documentId:id,title:z.string(),revisionId:id,tabs:z.array(z.unknown()).min(1).max(100)}).parse(value);
  const tabs=flattenTabs(doc.tabs,0);
  const selected=scope.kind==="single-tab"?tabs[0]:tabs.find(tab=>tab.tabProperties.tabId===scope.tabId);
  if(!selected) throw new TypeError("지정한 문서 탭이 없어요.");
  const body=selected.documentTab.body.content;
  const raw:string=body.flatMap(item=>item.paragraph?.elements.map(run=>run.textRun.content)??[]).join("");
  if(!raw.endsWith("\n")) throw new TypeError("문서 본문의 마지막 문단 경계를 확인하지 못했어요.");
  if(Math.max(...body.map(item=>item.endIndex))!==raw.length+1) throw new TypeError("본문 인덱스와 추출한 텍스트 범위가 일치하지 않아요.");
  return {documentId:doc.documentId,title:doc.title,revisionId:doc.revisionId,tabId:selected.tabProperties.tabId,tabCount:tabs.length,text:raw.slice(0,-1),bodyEndIndex:Math.max(...body.map(item=>item.endIndex))};
}
export function googleDocumentObservation(value:GoogleDocumentObservation):ExternalObservation {
  return {status:"available",externalId:value.documentId,content:{kind:"document",title:value.title,text:value.text,tabId:value.tabId,documentTabCount:value.tabCount}};
}
/** 행 범위를 모두 읽은 응답만 검증에 사용하며 원문 숫자·불리언의 자료형을 유지합니다. */
export function googleSheetRowsObservation(value:unknown,spreadsheetId:string,sheetName:string,startRow:number,endRow:number):ExternalObservation {
  const parsed=z.object({range:z.string().min(1),majorDimension:z.literal("ROWS").optional(),values:z.array(z.array(z.union([z.string(),z.number().finite(),z.boolean()])).max(100)).max(1001).optional()}).parse(value);
  z.number().int().min(1000).max(1001).parse(endRow);
  const range=parsed.range.match(/^(.*?)!A1:CV(1000|1001)$/);
  if(!range || Number(range[2])!==endRow || ![sheetName,`'${sheetName.replaceAll("'","''")}'`].includes(range[1]) || startRow!==1) throw new TypeError("조회한 시트와 전체 행 범위가 일치하지 않아요.");
  const rows=parsed.values??[];
  if(rows.length>=1000) return {status:"unavailable",reason:"incomplete-search"};
  return {status:"available",externalId:spreadsheetId,content:{kind:"sheet-rows",startRow,rows}};
}
export function googleEventObservation(value:unknown,calendarId:string):ExternalObservation {
  const time=z.object({dateTime:z.string().datetime({offset:true}),timeZone:z.literal("Asia/Seoul")});
  const event=z.object({id,summary:z.string(),description:z.string(),status:z.string().optional(),start:time,end:time,recurrence:z.array(z.string()).max(1).optional(),extendedProperties:z.object({private:z.object({alterBusinessKey:id})})}).parse(value);
  if(event.status==="cancelled") return {status:"unavailable",reason:"not-found"};
  return {status:"available",externalId:calendarId,content:{kind:"calendar-event",eventId:event.id,businessKey:event.extendedProperties.private.alterBusinessKey,summary:event.summary,description:event.description,start:event.start,end:event.end,recurrence:event.recurrence??[]}};
}
