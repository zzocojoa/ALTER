import { runGoogleAcceptance, googleAcceptanceCells, googleAcceptanceStep, googleAcceptanceText } from "../../lib/google/acceptance.ts";
import { googleRequestedScopes } from "../../lib/google/permissions.ts";
import { executeGoogleRest } from "../../lib/google/execute.ts";
import type { GoogleExecutionRuntime, GoogleExecutionSettings } from "../../lib/google/execute.ts";
import { googleMethodPolicies } from "../../lib/google/permissions.ts";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import { saveGoogleStorageObservation } from "../../db/repositories/google-observations.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleQuota } from "./google-quota.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
export async function checkGoogleAcceptance(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T00:00:00Z");
  const fixture = await fixtureGoogleConnection(db, "acceptance-owner", now);
  const base = fixtureGoogleQuota(fixture.owner.userId, now, 10000, 10000);
  const costs = [{ metric: "request-minute", scope: "project", units: 1 }, { metric: "request-minute", scope: "user", units: 1 }];
  const quota = googleQuotaPolicy.parse({ ...base, apis: ["drive", "docs", "sheets", "calendar"].map(api => ({ ...base.apis[0], api, dimensions: base.apis[0].dimensions.map(d => ({ ...d, metric: "request-minute", unit: "requests", actions: ["read", "write", "create"] })) })), methods: Object.entries(googleMethodPolicies).filter(([method]) => method !== "picker.open").map(([method, policy]) => ({ method, source: policy.source, costs })) });
  const settings: GoogleExecutionSettings = { credentials: { clientId: fixtureGoogleOAuth(now).clientId, clientSecret: "fixture-secret", keyring: fixture.keyring }, project: { ...fixtureGoogleProject(now), ownerId: fixture.owner.userId, projectId: quota.projectId, consoleSource: `https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}` }, quota };
  let documentText: string = ""; let writes: number = 0; let calls: number = 0; let refreshes: number = 0;
  const runtime: GoogleExecutionRuntime = { oauth: { fetch: async (url, options) => { new Request(url, options); ensure(url === "https://oauth2.googleapis.com/token" && new URLSearchParams(String(options.body)).get("grant_type") === "refresh_token", "잘못된 갱신 경로"); refreshes += 1; return Response.json({ access_token: "refreshed-fixed-token", expires_in: 3600, token_type: "Bearer", scope: googleRequestedScopes.join(" ") }); }, now: () => now, wait: async () => {}, warn: () => {} }, rest: { now: () => now, wait: async () => {}, warn: () => {}, fetch: async (raw, options) => {
    new Request(raw, options); calls += 1; const url: URL = new URL(raw);
    if (url.pathname === "/drive/v3/about") return Response.json({ storageQuota: { limit: "10000000", usage: "0" } });
    if (url.pathname.startsWith("/drive/v3/files/")) { const id: string = url.pathname.split("/").at(-1) ?? ""; return Response.json({ id, name: "시험", mimeType: id === "fixture-doc" ? "application/vnd.google-apps.document" : "application/vnd.google-apps.spreadsheet", trashed: false, isAppAuthorized: true, modifiedTime: new Date(now).toISOString(), capabilities: { canEdit: true } }); }
    if (options.method !== "GET") writes += 1;
    if (url.pathname === "/v1/documents") return Response.json({ documentId: "fixture-doc" });
    if (url.pathname.endsWith(":batchUpdate")) { documentText = googleAcceptanceText; return Response.json({}); }
    if (url.pathname === "/v1/documents/fixture-doc") return Response.json({ documentId:"fixture-doc",title:"ALTER Task 14 API 검증", revisionId: "fixture-revision", tabs:[{tabProperties:{tabId:"t.0"},documentTab:{body: { content: [{ startIndex:1,endIndex:documentText.length+2,paragraph: { elements: [{ textRun: { content: documentText+"\n" } }] } }] }}}] });
    if (url.pathname === "/v4/spreadsheets") return Response.json({ spreadsheetId: "fixture-sheet" });
    if (url.pathname.startsWith("/v4/spreadsheets/fixture-sheet/values/")) return Response.json(options.method === "GET" ? { values: googleAcceptanceCells } : {});
    if (url.pathname === "/calendar/v3/calendars") return Response.json({ id: "fixture-cal@group.calendar.google.com" });
    if (url.pathname.includes("/events")) return Response.json({ id: "altertask14", summary: "ALTER Task 14 API 검증", description: "ALTER 전용 캘린더 접근 시험. 과거 날짜의 고정 시험 일정입니다.", start: { dateTime: "2020-01-01T10:00:00+09:00", timeZone: "Asia/Seoul" } });
    throw new Error(`예상하지 않은 고정 시험 경로: ${url.pathname}`);
  } } };
  const probe = await executeGoogleRest(db, fixture.owner, settings, { method: "drive.about.get" }, { id: crypto.randomUUID(), role: "account", storageUpperBytes: 0, selection:null,context:null}, runtime);
  await saveGoogleStorageObservation(db, fixture.owner, fixture.connection, probe.attemptId, quota.projectId, probe.data, now);
  const target = { connectionId: fixture.connection.connectionId, generation: fixture.connection.generation };
  for (const step of googleAcceptanceStep.options) ensure((await runGoogleAcceptance(db, fixture.owner, settings, runtime, { ...target, step })).status === "passed", "고정 시험 단계 실패");
  ensure(writes === 6, "고정 시험 쓰기 수 불일치");
  for (const step of googleAcceptanceStep.options) await runGoogleAcceptance(db, fixture.owner, settings, runtime, { ...target, step });
  ensure(writes === 6, "고정 시험 반복 쓰기 발생");
  ensure(refreshes === 1, "고정 갱신 재전송 발생");
  documentText = "사용자 변경";
  let conflict: boolean = false;
  try { await runGoogleAcceptance(db, fixture.owner, settings, runtime, { ...target, step: "verify" }); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "google_request_unknown") conflict = true; else throw error; }
  ensure(conflict && writes === 6, "내용 충돌 누락 또는 덮어쓰기");
  const before: number = calls;
  await db.prepare("UPDATE google_requests SET state='unknown' WHERE owner_id=? AND method='docs.documents.create'").bind(fixture.owner.userId).run();
  let blocked: boolean = false;
  try { await runGoogleAcceptance(db, fixture.owner, settings, runtime, { ...target, step: "docs-create" }); } catch (error: unknown) { if (error instanceof Error && "code" in error && error.code === "google_request_unknown") blocked = true; else throw error; }
  ensure(blocked && calls === before, "미확정 시험 생성 재전송");
  return ["fixed-google-fixture-six-writes-and-readback", "fixed-fixture-replay-does-not-repeat-writes", "fixed-fixture-conflict-and-unknown-stop-without-overwrite", "fixed-refresh-one-provider-call-and-no-consent-extension"];
}
