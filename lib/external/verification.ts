import { z } from "zod";
import { contentHash, timestamp } from "../domain/contracts.ts";

const identifier = z.string().min(1).max(1024);
const title = z.string().min(1).max(200);
const cell = z.union([z.string().max(50_000), z.number().finite(), z.boolean()]);
const row = z.array(cell).min(1).max(100);
const tabScope = z.discriminatedUnion("kind", [z.object({kind:z.literal("single-tab")}).strict(), z.object({kind:z.literal("selected-tab"),tabId:identifier}).strict()]);
const eventTime = z.object({dateTime:z.string().datetime({offset:true}),timeZone:z.literal("Asia/Seoul")}).strict();
const recurrence = z.array(z.string().regex(/^RRULE:[A-Z0-9=;,]+$/)).max(1);
export const externalTargetReference = z.discriminatedUnion("source", [
  z.object({source:z.literal("known"),externalId:identifier}).strict(),
  z.object({source:z.literal("operation"),businessKey:z.string().min(1).max(200)}).strict(),
]);
export type ExternalTargetReference = Readonly<z.infer<typeof externalTargetReference>>;
const reportRowShape=z.object({kind:z.literal("report-row"),businessKey:identifier,document:externalTargetReference,values:z.array(cell).length(10)}).strict();
export const reportRowExpected=reportRowShape.refine(value=>value.values[0]===value.businessKey && value.values[8]==="","주간 행의 업무 키와 문서 링크 예약 칸이 일치하지 않아요.");
export const externalExpected = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("document"),title,text:z.string().max(200_000),tab:tabScope}).strict(),
  z.object({kind:z.literal("sheet"),title}).strict(),
  z.object({kind:z.literal("sheet-row"),businessKey:identifier,keyColumn:z.number().int().min(0).max(99),values:row}).strict(),
  z.object({kind:z.literal("calendar"),title,timeZone:z.literal("Asia/Seoul")}).strict(),
  z.object({kind:z.literal("calendar-event"),eventId:z.string().regex(/^[a-v0-9]{5,1024}$/),businessKey:identifier,summary:title,description:z.string().max(10_000),start:eventTime,end:eventTime,recurrence}).strict(),
  z.object({kind:z.literal("folder"),title,businessKey:identifier}).strict(),
  z.object({kind:z.literal("file-placement"),parent:externalTargetReference,businessKey:identifier}).strict(),
  reportRowShape,
]);
export type ExternalExpected = Readonly<z.infer<typeof externalExpected>>;
const content = z.discriminatedUnion("kind", [
  z.object({kind:z.literal("document"),title,text:z.string().max(200_000),tabId:identifier,documentTabCount:z.number().int().positive()}).strict(),
  z.object({kind:z.literal("sheet"),title}).strict(),
  z.object({kind:z.literal("sheet-rows"),startRow:z.number().int().positive(),rows:z.array(z.array(cell).max(100)).max(1001)}).strict(),
  z.object({kind:z.literal("calendar"),title,timeZone:z.string()}).strict(),
  z.object({kind:z.literal("calendar-event"),eventId:identifier,businessKey:identifier,summary:title,description:z.string().max(10_000),start:eventTime,end:eventTime,recurrence}).strict(),
  z.object({kind:z.literal("folder"),title,businessKey:identifier}).strict(),
  z.object({kind:z.literal("file-placement"),parent:externalTargetReference,parentId:identifier,businessKey:identifier}).strict(),
  z.object({kind:z.literal("report-rows"),document:externalTargetReference,documentId:z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),startRow:z.number().int().positive(),rows:z.array(z.array(cell).max(100)).max(1001)}).strict(),
]);
export const externalObservation = z.discriminatedUnion("status", [
  z.object({status:z.literal("available"),externalId:identifier,content}).strict(),
  z.object({status:z.literal("unavailable"),reason:z.enum(["not-found","incomplete-search","request-failed","unsupported-content","missing-external-id"])}).strict(),
]);
export type ExternalObservation = Readonly<z.infer<typeof externalObservation>>;
export const externalVerification = z.discriminatedUnion("status", [
  z.object({status:z.literal("matched"),externalId:identifier,expectedHash:z.string().length(64),observedHash:z.string().length(64),checkedAt:timestamp,position:z.number().int().positive().nullable()}).strict(),
  z.object({status:z.literal("conflict"),reason:z.enum(["target-mismatch","content-mismatch","duplicate-business-key","tab-scope-mismatch","wrong-content-type"]),checkedAt:timestamp}).strict(),
  z.object({status:z.literal("unknown"),reason:z.enum(["not-found","incomplete-search","request-failed","unsupported-content","missing-external-id","business-key-not-found"]),checkedAt:timestamp}).strict(),
  z.object({status:z.literal("not-executed"),basis:z.enum(["durable-intent-absent-and-fenced","google-write-request-absent-and-fenced"]),priorEpoch:z.number().int().positive(),fencedEpoch:z.number().int().positive(),checkedAt:timestamp}).strict(),
]).refine(value=>value.status!=="not-executed" || value.fencedEpoch>value.priorEpoch,"이전 실행보다 새로운 선점 버전이 필요합니다.");
export type ExternalVerification = Readonly<z.infer<typeof externalVerification>>;
type Comparison = Readonly<{matches:boolean;position:number|null;reason:"content-mismatch"|"duplicate-business-key"|"tab-scope-mismatch"|"wrong-content-type"|"business-key-not-found"}>;

function canonicalRecurrence(value: readonly string[]): readonly string[] {
  return value.map(rule => {
    const fields: readonly string[] = rule.slice(6).split(";");
    if (new Set(fields.map(field => field.split("=")[0])).size !== fields.length) throw new TypeError("반복 규칙의 항목이 중복됐어요.");
    return `RRULE:${[...fields].sort().join(";")}`;
  }).sort();
}
function compareContent(expected: ExternalExpected, observed: z.infer<typeof content>): Comparison {
  if(expected.kind==="report-row" && observed.kind==="report-rows") {
    reportRowExpected.parse(expected);
    if(JSON.stringify(expected.document)!==JSON.stringify(observed.document)) return {matches:false,position:null,reason:"content-mismatch"};
    const values=expected.values.map((value,index)=>index===8?`https://docs.google.com/document/d/${observed.documentId}/edit`:value);
    return compareContent({kind:"sheet-row",businessKey:expected.businessKey,keyColumn:0,values},{kind:"sheet-rows",startRow:observed.startRow,rows:observed.rows});
  }
  if (expected.kind === "file-placement" && observed.kind === "file-placement") return {matches:JSON.stringify(expected.parent)===JSON.stringify(observed.parent) && expected.businessKey===observed.businessKey,position:null,reason:"content-mismatch"};
  if (expected.kind === "folder" && observed.kind === "folder") return {matches:expected.title===observed.title && expected.businessKey===observed.businessKey,position:null,reason:"content-mismatch"};
  if (expected.kind === "document" && observed.kind === "document") {
    if (expected.tab.kind === "single-tab" && observed.documentTabCount !== 1 || expected.tab.kind === "selected-tab" && observed.tabId !== expected.tab.tabId) return {matches:false,position:null,reason:"tab-scope-mismatch"};
    return {matches:expected.title===observed.title && expected.text===observed.text,position:null,reason:"content-mismatch"};
  }
  if (expected.kind === "sheet" && observed.kind === "sheet") return {matches:expected.title===observed.title,position:null,reason:"content-mismatch"};
  if (expected.kind === "calendar" && observed.kind === "calendar") return {matches:expected.title===observed.title && expected.timeZone===observed.timeZone,position:null,reason:"content-mismatch"};
  if (expected.kind === "sheet-row" && observed.kind === "sheet-rows") {
    if (expected.values[expected.keyColumn] !== expected.businessKey) throw new TypeError("성과표 기대값의 업무 키와 열 위치가 일치하지 않아요.");
    const matches = observed.rows.map((values,index)=>({values,index})).filter(item=>item.values[expected.keyColumn]===expected.businessKey);
    if (matches.length===0) return {matches:false,position:null,reason:"business-key-not-found"};
    if (matches.length>1) return {matches:false,position:null,reason:"duplicate-business-key"};
    const actual = matches[0]; const equal: boolean = expected.values.every((value,index)=>value===(actual.values[index] ?? "")) && actual.values.slice(expected.values.length).every(value=>value==="");
    return {matches:equal,position:observed.startRow+actual.index,reason:"content-mismatch"};
  }
  if (expected.kind === "calendar-event" && observed.kind === "calendar-event") {
    const equal: boolean = expected.eventId===observed.eventId && expected.businessKey===observed.businessKey && expected.summary===observed.summary && expected.description===observed.description && expected.start.timeZone===observed.start.timeZone && expected.end.timeZone===observed.end.timeZone && Date.parse(expected.start.dateTime)===Date.parse(observed.start.dateTime) && Date.parse(expected.end.dateTime)===Date.parse(observed.end.dateTime) && JSON.stringify(canonicalRecurrence(expected.recurrence))===JSON.stringify(canonicalRecurrence(observed.recurrence));
    return {matches:equal,position:null,reason:"content-mismatch"};
  }
  return {matches:false,position:null,reason:"wrong-content-type"};
}

/** 대상 미발견은 미실행 증명이 아니며 업무 키 중복과 사용자 변경은 충돌로 보존합니다. */
export async function verifyExternalContent(value: ExternalExpected, externalId: string, observedValue: ExternalObservation, now: number): Promise<ExternalVerification> {
  const expected: ExternalExpected = externalExpected.parse(value); const observation: ExternalObservation = externalObservation.parse(observedValue); identifier.parse(externalId); timestamp.parse(now);
  if (observation.status === "unavailable") return {status:"unknown",reason:observation.reason,checkedAt:now};
  if (observation.externalId!==externalId) return {status:"conflict",reason:"target-mismatch",checkedAt:now};
  const result: Comparison = compareContent(expected, observation.content);
  if (result.reason === "business-key-not-found") return {status:"unknown",reason:result.reason,checkedAt:now};
  if (!result.matches) return {status:"conflict",reason:result.reason,checkedAt:now};
  return {status:"matched",externalId,expectedHash:await contentHash(expected),observedHash:await contentHash(observation.content),checkedAt:now,position:result.position};
}
