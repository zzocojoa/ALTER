import { readGoogleDocumentObservation } from "../external/google-observation.ts";
import { z } from "zod";
import { contentHash } from "../domain/contracts.ts";
import type { SiteIdentity } from "../domain/contracts.ts";
import { readStorage } from "../../db/repositories/atomic.ts";
import { readManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import type { ManagedGoogleConnection } from "../../db/repositories/google-managed.ts";
import { renewGoogleAccessToken } from "./access-token.ts";
import { googleFailure } from "./errors.ts";
import { executeGoogleRest } from "./execute.ts";
import type { GoogleExecutionResult, GoogleExecutionRuntime, GoogleExecutionSettings } from "./execute.ts";
import type { GoogleRestInput } from "./rest-request.ts";
import type { GoogleResourceRole } from "./permissions.ts";

export const googleAcceptanceStep = z.enum(["docs-create", "docs-write", "sheets-create", "sheets-write", "calendar-create", "calendar-write", "verify", "refresh"]);
export type GoogleAcceptanceStep = z.infer<typeof googleAcceptanceStep>;
export const googleAcceptanceText: string = "ALTER Task 14 API 검증\n자체 작성 시험 자료: 분수 1/4은 같은 크기의 네 부분 중 한 부분입니다.\n";
export const googleAcceptanceCells: readonly (readonly string[])[] = [["검증", "Task 14"], ["분수", "1/4"]];
const title: string = "ALTER Task 14 API 검증";
const eventId: string = "altertask14";
type FixtureReceipt = Readonly<{ state: string; result_external_id: string | null; connection_id: string; generation: number }>;
type FixtureContext = Readonly<{ db: D1Database; owner: SiteIdentity; settings: GoogleExecutionSettings; runtime: GoogleExecutionRuntime; connection: ManagedGoogleConnection }>;
export type GoogleAcceptanceResult = Readonly<{ status: "passed"; step: GoogleAcceptanceStep; externalId: string | null }>;

/** 계정 재연결이나 버튼 재실행으로 시험 쓰기의 식별자가 바뀌지 않게 합니다. */
export async function googleAcceptanceId(ownerId: string, projectId: string, step: GoogleAcceptanceStep): Promise<string> {
  const hash: string = await contentHash({ fixture: "google-task14-v1", ownerId, projectId, step });
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}
async function receipt(context: FixtureContext, step: GoogleAcceptanceStep): Promise<FixtureReceipt | null> {
  const id: string = await googleAcceptanceId(context.owner.userId, context.settings.project.projectId, step);
  const result = await readStorage("google.acceptance.receipt", () => context.db.prepare("SELECT state,result_external_id,connection_id,generation FROM google_requests WHERE owner_id=? AND id=?").bind(context.owner.userId, id).first<FixtureReceipt>());
  if (result && (result.state !== "succeeded" || result.connection_id !== context.connection.connectionId || result.generation !== context.connection.generation)) throw googleFailure("google_request_unknown", `acceptance-${step}-reconciliation-required`);
  return result;
}
async function createdId(context: FixtureContext, step: GoogleAcceptanceStep): Promise<string> {
  const saved: FixtureReceipt | null = await receipt(context, step);
  if (!saved?.result_external_id) throw googleFailure("google_configuration_invalid", `acceptance-${step}-required`);
  return saved.result_external_id;
}
async function readFixture(context: FixtureContext, input: GoogleRestInput, role: GoogleResourceRole): Promise<GoogleExecutionResult> {
  return executeGoogleRest(context.db, context.owner, context.settings, input, { id: crypto.randomUUID(), role, storageUpperBytes: 0, selection:null,context:null}, context.runtime);
}
async function writeFixture(context: FixtureContext, step: GoogleAcceptanceStep, input: GoogleRestInput, role: GoogleResourceRole): Promise<GoogleAcceptanceResult> {
  const saved: FixtureReceipt | null = await receipt(context, step);
  if (saved) return { status: "passed", step, externalId: saved.result_external_id };
  const id: string = await googleAcceptanceId(context.owner.userId, context.settings.project.projectId, step);
  const result = await executeGoogleRest(context.db, context.owner, context.settings, input, { id, role, storageUpperBytes: 65_536, selection:null,context:null}, context.runtime);
  return { status: "passed", step, externalId: result.externalId };
}
export function readGoogleAcceptanceDocument(value: unknown): Readonly<{text:string;revisionId:string;tabId:string;endIndex:number}> {
  const doc=readGoogleDocumentObservation(value,{kind:"single-tab"});
  if(doc.tabCount!==1) throw googleFailure("google_request_unknown","acceptance-document-tabs");
  return {text:doc.text,revisionId:doc.revisionId,tabId:doc.tabId,endIndex:doc.bodyEndIndex};
}
async function writeDocument(context: FixtureContext): Promise<GoogleAcceptanceResult> {
  const documentId: string = await createdId(context, "docs-create");
  const saved: FixtureReceipt | null = await receipt(context, "docs-write");
  if (saved) return { status: "passed", step: "docs-write", externalId: documentId };
  const document = readGoogleAcceptanceDocument((await readFixture(context, { method: "docs.documents.get", documentId }, "docs-target")).data);
  if (document.text.trim() !== "") throw googleFailure("google_request_unknown", "acceptance-document-not-empty");
  return writeFixture(context, "docs-write", { method: "docs.documents.batchUpdate", documentId, revisionId: document.revisionId, text: googleAcceptanceText,tabId:document.tabId,endIndex:document.endIndex }, "docs-target");
}
async function verifyFixture(context: FixtureContext): Promise<GoogleAcceptanceResult> {
  const documentId: string = await createdId(context, "docs-create");
  const spreadsheetId: string = await createdId(context, "sheets-create");
  const calendarId: string = await createdId(context, "calendar-create");
  for (const step of ["docs-write", "sheets-write", "calendar-write"] as const) if (!await receipt(context, step)) throw googleFailure("google_configuration_invalid", `acceptance-${step}-required`);
  const document = readGoogleAcceptanceDocument((await readFixture(context, { method: "docs.documents.get", documentId }, "docs-target")).data);
  if (document.text.trim() !== googleAcceptanceText.trim()) throw googleFailure("google_request_unknown", "acceptance-document-content-mismatch");
  const sheet = z.object({ values: z.array(z.array(z.string())) }).parse((await readFixture(context, { method: "sheets.values.get", spreadsheetId, range: "A1:B2" }, "sheets-target")).data);
  if (JSON.stringify(sheet.values) !== JSON.stringify(googleAcceptanceCells)) throw googleFailure("google_request_unknown", "acceptance-sheet-content-mismatch");
  const event = z.object({ id: z.literal(eventId), summary: z.literal(title), description: z.literal("ALTER 전용 캘린더 접근 시험. 과거 날짜의 고정 시험 일정입니다."), start: z.object({ dateTime: z.string(), timeZone: z.literal("Asia/Seoul") }) }).parse((await readFixture(context, { method: "calendar.events.get", calendarId, eventId }, "calendar-target")).data);
  if (Date.parse(event.start.dateTime) !== Date.parse("2020-01-01T10:00:00+09:00")) throw googleFailure("google_request_unknown", "acceptance-calendar-time-mismatch");
  return { status: "passed", step: "verify", externalId: null };
}

/** 고정 식별자의 갱신 영수증을 먼저 확인하여 재실행과 결과 불명 재전송을 막습니다. */
async function refreshFixture(context: FixtureContext): Promise<GoogleAcceptanceResult> {
  await createdId(context, "docs-create");
  const id: string = await googleAcceptanceId(context.owner.userId, context.settings.project.projectId, "refresh");
  const receipts = await readStorage("google.acceptance.refresh-receipts", () => context.db.prepare("SELECT scope,request_key FROM atomic_requests WHERE owner_id=? AND ((scope='google.refresh.claim' AND request_key=?) OR (scope='google.refresh.complete' AND request_key=?))").bind(context.owner.userId, id, `${id}:complete`).all<{ scope: string; request_key: string }>());
  if (!receipts.results.some(item => item.scope === "google.refresh.complete")) {
    if (receipts.results.length !== 0) throw googleFailure("google_request_unknown", "acceptance-refresh-reconciliation-required");
    const refreshed = await renewGoogleAccessToken(context.db, context.owner, context.settings.credentials, context.runtime.oauth, id);
    if (context.connection.refreshExpiresAt !== null && (refreshed.connection.refreshExpiresAt === null || refreshed.connection.refreshExpiresAt > context.connection.refreshExpiresAt)) throw googleFailure("google_request_unknown", "acceptance-refresh-consent-deadline-extended");
  }
  await readFixture(context, { method: "drive.about.get" }, "account");
  return { status: "passed", step: "refresh", externalId: null };
}

/** 개인 자료나 임의 ID를 받지 않고 명시적으로 켠 고정 시험만 기존 권한·quota 경로로 실행합니다. */
export async function runGoogleAcceptance(db: D1Database, owner: SiteIdentity, settings: GoogleExecutionSettings, runtime: GoogleExecutionRuntime, target: Readonly<{ connectionId: string; generation: number; step: GoogleAcceptanceStep }>): Promise<GoogleAcceptanceResult> {
  const connection = await readManagedGoogleConnection(db, owner);
  if (!connection || connection.state !== "active" || connection.connectionId !== target.connectionId || connection.generation !== target.generation) throw googleFailure("google_connection_unavailable", "acceptance-connection");
  const context: FixtureContext = { db, owner, settings, runtime, connection };
  switch (target.step) {
    case "docs-create": return writeFixture(context, target.step, { method: "docs.documents.create", title }, "docs-create");
    case "docs-write": return writeDocument(context);
    case "sheets-create": return writeFixture(context, target.step, { method: "sheets.spreadsheets.create", title }, "sheets-create");
    case "sheets-write": return writeFixture(context, target.step, { method: "sheets.values.update", spreadsheetId: await createdId(context, "sheets-create"), range: "A1:B2", values: googleAcceptanceCells.map(row => [...row]) }, "sheets-target");
    case "calendar-create": return writeFixture(context, target.step, { method: "calendar.calendars.insert", title }, "calendar-create");
    case "calendar-write": return writeFixture(context, target.step, { method: "calendar.events.insert", calendarId: await createdId(context, "calendar-create"), eventId, event: { summary: title, description: "ALTER 전용 캘린더 접근 시험. 과거 날짜의 고정 시험 일정입니다.", start: { dateTime: "2020-01-01T10:00:00+09:00", timeZone: "Asia/Seoul" }, end: { dateTime: "2020-01-01T10:10:00+09:00", timeZone: "Asia/Seoul" }, recurrence: [],businessKey:"task14-fixed-event" } }, "calendar-target");
    case "verify": return verifyFixture(context);
    case "refresh": return refreshFixture(context);
  }
}
