import { restoredGoogleObservationReader } from "../../lib/backup/reconciliation-google.ts";
import { recordId } from "../../lib/domain/contracts.ts";
import { z } from "zod";
import { googleQuotaPolicy } from "../../lib/google/quota.ts";
import type { GoogleExecutionSettings } from "../../lib/google/execute.ts";
import type { GoogleRestRuntime } from "../../lib/google/rest-transport.ts";
import type { GoogleTokenKeyring } from "../../lib/google/token-crypto.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleOAuth } from "./google-oauth.ts";
import { reconcileRestoredOperation } from "../../lib/backup/reconcile.ts";
import { restoreReconciliationView } from "../../lib/backup/reconciliation.ts";
import { finishRestoreReconciliation, startRestoreReconciliation, readRestoreReconciliation } from "../../db/repositories/restore-reconciliation.ts";
import { readExternalOperation } from "../../db/repositories/external-operation.ts";
import { readGoogleExternalContract } from "../../lib/external/google-contract.ts";

function ensure(value: boolean, message: string): void { if (!value) throw new Error(message); }
async function reject(action: () => Promise<unknown>): Promise<void> {
  let error: unknown = null; try { await action(); } catch (caught: unknown) { error = caught; }
  ensure(error instanceof Error, "요청 차단 누락");
}
/** 실제 로컬 D1 상태와 모의 제공사 응답을 사용해 대조만 하고 원래 기록은 바꾸지 않음을 검사합니다. */
export async function checkRestoreReconciliation(db: D1Database, owner: SiteIdentity, keyring: GoogleTokenKeyring, now: number): Promise<readonly string[]> {
  const historical = await db.prepare("SELECT snapshot FROM google_quota_policies WHERE owner_id=? LIMIT 1").bind(owner.userId).first<string>("snapshot"); if (historical === null) throw new Error("이전 quota 설정 없음");
  const previous = googleQuotaPolicy.parse(JSON.parse(historical));
  const quota = { ...previous, ownerId: owner.userId, version: previous.version + 1, checkedAt: now, validUntil: now + 60_000, apis: previous.apis.map(api => ({ ...api, dimensions: api.dimensions.map(dimension => ({ ...dimension, consoleObservedAt: now, consoleWindowStart: now - 60_000, consoleWindowEnd: now })) })) };
  const project = { ...fixtureGoogleProject(now), ownerId: owner.userId, projectId: quota.projectId, consoleSource: `https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}` };
  const settings: GoogleExecutionSettings = { credentials: { clientId: fixtureGoogleOAuth(now).clientId, clientSecret: "fixture-only", keyring }, project, quota };
  const id = await db.prepare("SELECT id FROM external_operations WHERE owner_id=? AND business_key='restore-expired-document'").bind(owner.userId).first<string>("id"); if (id === null) throw new Error("만료 임대 시험 기록 없음");
  const operation = await readExternalOperation(db, owner, id); ensure(operation.state === "running" && operation.leaseUntil !== null && operation.leaseUntil < now, "만료 임대 상태 없음");
  const expected = readGoogleExternalContract(operation).expected; if (expected.kind !== "document" || operation.externalId === null) throw new Error("문서 기대값 없음");
  const before = JSON.stringify(await db.prepare("SELECT * FROM external_operations WHERE owner_id=? ORDER BY id").bind(owner.userId).all());
  let calls: number = 0; let writes: number = 0;
  const runtime: GoogleRestRuntime = { now: () => now, wait: async () => {}, warn: () => {}, fetch: async (url, options) => {
    calls += 1; if (options.method !== "GET") writes += 1;
    if (url.includes("/drive/v3/files/")) return Response.json({ id: operation.externalId, name: expected.title, mimeType: "application/vnd.google-apps.document", trashed: false, isAppAuthorized: true, modifiedTime: new Date(now).toISOString(), capabilities: { canEdit: true, canDownload: true } });
    if (url.includes("/v1/documents/")) return Response.json({ documentId: operation.externalId, title: expected.title, revisionId: "current-fixture-revision", tabs: [{ tabProperties: { tabId: "t.0" }, documentTab: { body: { content: [{ startIndex: 1, endIndex: expected.text.length + 2, paragraph: { elements: [{ textRun: { content: expected.text + "\n" } }] } }] } } }] });
    throw new Error("예상하지 않은 읽기 경로");
  } };
  const input = { id: recordId.parse(crypto.randomUUID()), operationId: recordId.parse(id), expectedVersion: operation.version };
  const matched = await reconcileRestoredOperation(db, owner, input, settings, runtime); ensure(restoreReconciliationView(matched).result?.status === "matched", "만료 작업 현재 내용 일치 대조 실패");
  ensure(calls === 2 && writes === 0, "조회 이외 전송 발생");
  await reconcileRestoredOperation(db, owner, input, settings, runtime); ensure(calls === 2, "동일 대조 요청이 재전송됨");
  await reject(() => reconcileRestoredOperation(db, { realm: "sites", userId: "other-owner" }, { ...input, id: recordId.parse(crypto.randomUUID()) }, settings, runtime)); ensure(calls === 2, "다른 소유자 전송");
  await reject(() => reconcileRestoredOperation(db, owner, { ...input, id: recordId.parse(crypto.randomUUID()) }, { ...settings, quota: previous }, runtime)); ensure(calls === 2, "과거 quota로 새 조회");
  const noQuota = { ...settings, quota: { ...quota, apis: quota.apis.map(api => ({ ...api, dimensions: api.dimensions.map(dimension => ({ ...dimension, appLimit: 1 })) })) } };
  await reject(() => reconcileRestoredOperation(db, owner, { ...input, id: recordId.parse(crypto.randomUUID()) }, noQuota, runtime)); ensure(calls === 2, "예약 한도 초과 뒤 전송");
  const missing = { ...runtime, fetch: async (_url: string, options: RequestInit): Promise<Response> => { calls += 1; if (options.method !== "GET") writes += 1; return Response.json({ error: { status: "NOT_FOUND" } }, { status: 404 }); } };
  const missingId: string = crypto.randomUUID(); await reject(() => reconcileRestoredOperation(db, owner, { ...input, id: recordId.parse(missingId) }, settings, missing));
  const failed = await readRestoreReconciliation(db, owner, missingId); ensure(failed !== null && restoreReconciliationView(failed).result?.status === "unknown", "404를 미실행으로 잘못 확정");
  const charges = await db.prepare("SELECT state FROM restore_google_reads ORDER BY reserved_at").all<{ state: string }>(); ensure(charges.results.length === 3 && charges.results.filter(row => row.state === "failed").length === 1, "실패 quota 예약 삭제");
  for (const trigger of ["BEFORE INSERT ON restore_reconciliations", "BEFORE INSERT ON restore_google_reads", "BEFORE UPDATE OF state ON restore_google_reads WHEN NEW.state='sending'"]) {
    const beforeCalls: number = calls;
    await db.prepare(`CREATE TRIGGER restore_read_zero ${trigger} BEGIN SELECT RAISE(IGNORE); END`).run();
    await reject(() => reconcileRestoredOperation(db, owner, { ...input, id: recordId.parse(crypto.randomUUID()) }, settings, runtime));
    await db.prepare("DROP TRIGGER restore_read_zero").run(); ensure(calls === beforeCalls, "조건부 예약·전송권 0행 뒤 요청 전송");
  }
  const concurrentInput = { ...input, id: recordId.parse(crypto.randomUUID()) }; const beforeConcurrent: number = calls;
  await Promise.all([reconcileRestoredOperation(db, owner, concurrentInput, settings, runtime), reconcileRestoredOperation(db, owner, concurrentInput, settings, runtime)]);
  ensure(calls === beforeConcurrent + 2, "동일 대조 동시 실행이 중복 전송");
  const writeId = recordId.parse(crypto.randomUUID()); await startRestoreReconciliation(db, owner, { ...input, id: writeId }, now);
  const matchedProof = restoreReconciliationView(matched).result; if (matchedProof === null) throw new Error("일치 근거 누락");
  await reject(() => finishRestoreReconciliation(db, owner, writeId, matchedProof, now + 60_000));
  await reject(() => finishRestoreReconciliation(db, owner, writeId, { ...matchedProof, checkedAt: now + 1 }, now));
  const reader = restoredGoogleObservationReader(db, owner, writeId, settings, runtime); const beforeWrite: number = calls;
  await reject(() => reader.call({ operation, attemptId: crypto.randomUUID(), beforeCall: async () => {} }, { method: "docs.documents.create", title: "forbidden" }, "docs-create", crypto.randomUUID())); ensure(calls === beforeWrite, "복원 조회 경로가 생성 요청 허용");
  const lostInput = { ...input, id: recordId.parse(crypto.randomUUID()) };
  await db.prepare("CREATE TRIGGER restore_finish_zero BEFORE UPDATE ON restore_reconciliations BEGIN SELECT RAISE(IGNORE); END").run();
  await reject(() => reconcileRestoredOperation(db, owner, lostInput, settings, runtime));
  await db.prepare("DROP TRIGGER restore_finish_zero").run(); const afterLost: number = calls;
  const replay = await reconcileRestoredOperation(db, owner, lostInput, settings, runtime); ensure(replay.finished_at === null && calls === afterLost, "저장 결과 불명 대조 재전송");
  let warnings: number = 0; let waits: number = 0; let transient: boolean = true;
  const retryRuntime: GoogleRestRuntime = { ...runtime, warn: () => { warnings += 1; }, wait: async () => { waits += 1; }, fetch: async (url, options) => {
    if (transient) { transient = false; calls += 1; return Response.json({ error: { status: "RESOURCE_EXHAUSTED" } }, { status: 429 }); }
    return runtime.fetch(url, options);
  } };
  const retryInput = { ...input, id: recordId.parse(crypto.randomUUID()) };
  ensure(restoreReconciliationView(await reconcileRestoredOperation(db, owner, retryInput, settings, retryRuntime)).result?.status === "matched", "읽기 재시도 실패");
  ensure(warnings === 1 && waits === 1 && await db.prepare("SELECT count(*) AS n FROM restore_google_reads WHERE reconciliation_id=?").bind(retryInput.id).first<number>("n") === 3, "재시도 경고·실패 예약 보존 누락");
  const changedRuntime: GoogleRestRuntime = { ...runtime, fetch: async (url, options) => { const response = await runtime.fetch(url, options); if (!url.includes("/v1/documents/")) return response; const body: string = await response.text(); return new Response(body.replace(JSON.stringify(expected.text + "\n"), JSON.stringify("X" + expected.text.slice(1) + "\n")), { headers: { "content-type": "application/json" } }); } };
  const conflict = await reconcileRestoredOperation(db, owner, { ...input, id: recordId.parse(crypto.randomUUID()) }, settings, changedRuntime); ensure(restoreReconciliationView(conflict).result?.status === "conflict", "내용 변경을 일치 처리");
  const metadata = (await db.prepare("SELECT * FROM external_operations WHERE owner_id=? ORDER BY id").bind(owner.userId).all()).results;
  ensure(JSON.stringify(JSON.parse(before).results) === JSON.stringify(metadata), "대조가 원래 상태·임대·ID를 수정함");
  await reject(() => db.prepare("DELETE FROM restore_google_reads").run()); await reject(() => db.prepare("DELETE FROM restore_reconciliations").run());
  ensure(writes === 0, "외부 자동 쓰기 발생");
  const partial = (await db.prepare("SELECT business_key,state FROM external_operations WHERE owner_id=? AND business_key IN ('restore-partial-document','restore-partial-row') ORDER BY business_key").bind(owner.userId).all<{ business_key: string; state: string }>()).results;
  ensure(partial.length === 2 && partial[0].state === "confirmed" && partial[1].state === "unknown", "문서만 성공한 부분 반영 상태 소실");
  const uncertain = await db.prepare("SELECT count(*) AS n FROM external_operations WHERE owner_id=? AND state='unknown'").bind(owner.userId).first<number>("n"); ensure(z.number().parse(uncertain) > 0, "부분 반영 불명 상태 소실");
  return ["zero-row reservation/send denies transport; duplicate concurrent ID sends once; explicit write rejected; lost result never auto-replayed; GET retry retains all quota and warnings; changed content conflicts", "restored expired lease verified through existing Google observation contract with GET-only transport; same request replay, stale quota, quota exhaustion and foreign owner cause no additional calls", "404 remains unknown; failed read quota retained; all historical operation IDs/states/leases unchanged; new read and reconciliation receipts immutable; automatic writes zero"];
}
