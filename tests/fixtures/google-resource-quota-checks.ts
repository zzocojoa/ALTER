import { contentHash } from "../../lib/domain/contracts.ts";
import { prepareGoogleQuota } from "../../lib/google/quota.ts";
import { verifyGoogleFile } from "../../lib/google/resources.ts";
import { googlePickerCredentials, googlePickerSelection } from "../../lib/google/picker.ts";
import { beginGoogleRequest, finishGoogleRequest, installGoogleQuotaPolicy, reserveGoogleRequest, reserveGoogleStorageProbe } from "../../db/repositories/google-quota.ts";
import { consumeGooglePickerLease, readGoogleResource, registerGoogleSelectedFile, saveGooglePickerLease } from "../../db/repositories/google-resources.ts";
import { beginGoogleDisconnect } from "../../db/repositories/google-disconnect.ts";
import { fixtureGoogleConnection } from "./google-connected.ts";
import { fixtureGoogleProject } from "./google-project.ts";
import { fixtureGoogleQuota, fixtureGoogleStorage } from "./google-quota.ts";

function ensure(value: boolean, label: string): void { if (!value) throw new Error(label); }
async function rejected(run: () => Promise<unknown>, codes: readonly string[]): Promise<void> {
  try { await run(); } catch (error: unknown) { if (error instanceof Error && "code" in error && typeof error.code === "string" && codes.includes(error.code)) return; throw new Error(`예상 오류 ${codes.join(",")} 대신 ${error instanceof Error ? error.message : String(error)}; 원인: ${error instanceof Error && error.cause instanceof Error ? error.cause.message : "없음"}`, { cause: error }); }
  throw new Error(`필수 실패 미발생: ${codes.join(",")}`);
}
export async function checkGoogleResourceQuota(db: D1Database): Promise<readonly string[]> {
  const now: number = Date.parse("2026-10-25T00:00:00Z");
  const checks: string[] = [];
  const picker = await fixtureGoogleConnection(db, "picker-owner", now);
  const credentials = googlePickerCredentials.parse({ leaseId: crypto.randomUUID(), connectionId: picker.connection.connectionId, generation: 1, projectNumber: "123456789", origin: "https://alter.example.test", apiKey: "fixture-api-key-not-real", accessToken: "fixture-access", tokenExpiresAt: now + 3_600_000, leaseExpiresAt: now + 60_000 });
  await saveGooglePickerLease(db, picker.owner, credentials, "reference", now);
  const selection = googlePickerSelection.parse({ leaseId: credentials.leaseId, connectionId: credentials.connectionId, generation: 1, fileId: "selected-doc", role: "reference" });
  await rejected(() => consumeGooglePickerLease(db, picker.owner, { ...selection, role: "docs-target" }, now), ["google_scope_denied"]);
  await rejected(() => consumeGooglePickerLease(db, picker.owner, { ...selection, generation: 2 }, now), ["google_scope_denied"]);
  const consumption = await Promise.allSettled(Array.from({ length: 10 }, () => consumeGooglePickerLease(db, picker.owner, selection, now)));
  ensure(consumption.filter(item => item.status === "fulfilled").length === 1, "Picker 선택 중복 실행권");
  checks.push("picker-role-generation-ten-consumers-one-winner");
  const file = verifyGoogleFile({ id: "selected-doc", name: "검증 문서", mimeType: "application/vnd.google-apps.document", trashed: false, isAppAuthorized: true, modifiedTime: "2026-10-25T00:00:00Z", capabilities: { canEdit: true } }, selection.fileId, "reference", now);
  await registerGoogleSelectedFile(db, picker.owner, selection, file, now);
  ensure((await readGoogleResource(db, picker.owner, picker.connection, file.externalId, "reference")).role === "reference", "파일 승인 미저장");
  await rejected(() => readGoogleResource(db, picker.owner, picker.connection, file.externalId, "docs-target"), ["google_scope_denied"]);
  await rejected(() => registerGoogleSelectedFile(db, picker.owner, { ...selection, role: "docs-target" }, { ...file, role: "docs-target" }, now), ["request_key_reused", "version_conflict"]);
  await beginGoogleDisconnect(db, picker.owner, picker.connection, crypto.randomUUID(), now);
  await rejected(() => readGoogleResource(db, picker.owner, picker.connection, file.externalId, "reference"), ["google_scope_denied"]);
  checks.push("picker-server-file-role-no-escalation-disconnect-denies-old-grants");

  const concurrency = await fixtureGoogleConnection(db, "quota-concurrency", now);
  const policy = fixtureGoogleQuota(concurrency.owner.userId, now, 10, 10);
  const project = { ...fixtureGoogleProject(now), ownerId: concurrency.owner.userId, projectId: policy.projectId, consoleSource: `https://console.cloud.google.com/apis/dashboard?project=${policy.projectId}` };
  await installGoogleQuotaPolicy(db, concurrency.owner, policy); await installGoogleQuotaPolicy(db, concurrency.owner, policy);
  const plan = await prepareGoogleQuota(policy, project, concurrency.owner.userId, concurrency.connection.googleSubject, "drive.about.get", now);
  const requestHash: string = await contentHash({ method: plan.method });
  const inputs = Array.from({ length: 12 }, () => ({ attemptId: crypto.randomUUID(), requestHash, storageBytes: 0, now }));
  const raced = await Promise.allSettled(inputs.map(input => reserveGoogleStorageProbe(db, concurrency.owner, concurrency.connection, plan, input)));
  ensure(raced.filter(item => item.status === "fulfilled").length === 2, "한도 직전 동시 예약 초과");
  const won = inputs[raced.findIndex(item => item.status === "fulfilled")];
  await reserveGoogleStorageProbe(db, concurrency.owner, concurrency.connection, plan, won);
  await db.prepare("CREATE TRIGGER google_send_zero BEFORE UPDATE OF state ON google_requests WHEN NEW.state='sending' BEGIN SELECT RAISE(IGNORE); END").run();
  await rejected(() => beginGoogleRequest(db, concurrency.owner, won.attemptId, requestHash, now), ["google_request_unknown"]);
  await db.prepare("DROP TRIGGER google_send_zero").run();
  const sends = await Promise.allSettled(Array.from({ length: 10 }, () => beginGoogleRequest(db, concurrency.owner, won.attemptId, requestHash, now)));
  ensure(sends.filter(item => item.status === "fulfilled").length === 1, "동일 예약 중복 전송");
  await db.prepare("CREATE TRIGGER google_finish_zero BEFORE UPDATE OF state ON google_requests WHEN NEW.state='unknown' BEGIN SELECT RAISE(IGNORE); END").run();
  await rejected(() => finishGoogleRequest(db, concurrency.owner, won.attemptId, { state: "unknown", status: null, errorCode: "network", externalId: null, now }), ["google_request_unknown"]);
  await db.prepare("DROP TRIGGER google_finish_zero").run();
  checks.push("google-actual-returned-row-not-trigger-change-total-and-zero-update-denied");
  await finishGoogleRequest(db, concurrency.owner, won.attemptId, { state: "unknown", status: null, errorCode: "network", externalId: null, now });
  await rejected(() => beginGoogleRequest(db, concurrency.owner, won.attemptId, requestHash, now + 1), ["google_request_unknown"]);
  ensure((await db.prepare("SELECT SUM(weight) AS n FROM google_quota_charges WHERE owner_id=?").bind(concurrency.owner.userId).first<{ n: number }>())?.n === 20, "결과 불명 quota 환급");
  checks.push("twelve-quota-reservations-two-winners-one-send-unknown-retained");

  const rollback = await fixtureGoogleConnection(db, "quota-rollback", now);
  const firstPolicy = fixtureGoogleQuota(rollback.owner.userId, now, 100, 5);
  const rollbackProject = { ...project, ownerId: rollback.owner.userId };
  await installGoogleQuotaPolicy(db, rollback.owner, firstPolicy);
  const firstPlan = await prepareGoogleQuota(firstPolicy, rollbackProject, rollback.owner.userId, rollback.connection.googleSubject, "drive.files.get", now);
  const storage = fixtureGoogleStorage(rollback.owner.userId, rollback.connection.googleSubject, now);
  const firstInput = { attemptId: crypto.randomUUID(), requestHash, storageBytes: 0, now };
  await reserveGoogleRequest(db, rollback.owner, rollback.connection, firstPlan, firstInput, storage);
  await rejected(() => reserveGoogleRequest(db, rollback.owner, rollback.connection, firstPlan, { ...firstInput, attemptId: crypto.randomUUID() }, storage), ["version_conflict"]);
  ensure((await db.prepare("SELECT COUNT(*) AS n FROM google_requests WHERE owner_id=?").bind(rollback.owner.userId).first<{ n: number }>())?.n === 1, "다중 quota 부분 예약 커밋");
  checks.push("one-dimension-insufficient-rolls-back-entire-batch");
  const secondPolicy = { ...fixtureGoogleQuota(rollback.owner.userId, now, 100, 10), version: 2 };
  await installGoogleQuotaPolicy(db, rollback.owner, secondPolicy);
  await rejected(() => reserveGoogleRequest(db, rollback.owner, rollback.connection, firstPlan, { ...firstInput, attemptId: crypto.randomUUID() }, storage), ["version_conflict"]);
  const secondPlan = await prepareGoogleQuota(secondPolicy, rollbackProject, rollback.owner.userId, rollback.connection.googleSubject, "drive.files.get", now);
  await reserveGoogleRequest(db, rollback.owner, rollback.connection, secondPlan, { ...firstInput, attemptId: crypto.randomUUID() }, storage);
  await rejected(() => reserveGoogleRequest(db, rollback.owner, rollback.connection, secondPlan, { ...firstInput, attemptId: crypto.randomUUID() }, storage), ["version_conflict"]);
  checks.push("policy-change-preserves-old-charges-and-rejects-stale-policy");
  const futureProject = { ...rollbackProject, validUntil: now + 3_600_000, apis: Object.fromEntries(Object.entries(rollbackProject.apis).map(([key, value]) => [key, { ...value, validUntil: now + 3_600_000 }])) as typeof rollbackProject.apis };
  const future = await prepareGoogleQuota(secondPolicy, futureProject, rollback.owner.userId, rollback.connection.googleSubject, "drive.files.get", now + 90_001);
  await reserveGoogleRequest(db, rollback.owner, rollback.connection, future, { ...firstInput, attemptId: crypto.randomUUID(), now: now + 90_001 }, { ...storage, validUntil: now + 3_600_000 });
  await rejected(() => beginGoogleRequest(db, rollback.owner, firstInput.attemptId, requestHash, now + 90_001), ["google_request_unknown"]);
  checks.push("sliding-window-includes-send-delay-expired-reservation-not-replayed");

  const capacity = await fixtureGoogleConnection(db, "quota-capacity", now);
  const capacityPolicy = fixtureGoogleQuota(capacity.owner.userId, now, 100, 100);
  await installGoogleQuotaPolicy(db, capacity.owner, capacityPolicy);
  const capacityPlan = await prepareGoogleQuota(capacityPolicy, { ...project, ownerId: capacity.owner.userId }, capacity.owner.userId, capacity.connection.googleSubject, "drive.files.get", now);
  const capacityStorage = { ...fixtureGoogleStorage(capacity.owner.userId, capacity.connection.googleSubject, now), limitBytes: "100", usedBytes: "90" };
  const capacityResults = await Promise.allSettled(Array.from({ length: 2 }, () => reserveGoogleRequest(db, capacity.owner, capacity.connection, capacityPlan, { ...firstInput, attemptId: crypto.randomUUID(), storageBytes: 8 }, capacityStorage)));
  ensure(capacityResults.filter(item => item.status === "fulfilled").length === 1, "저장 용량 동시 초과");
  ensure((await db.prepare("SELECT COUNT(*) AS n FROM google_quota_charges WHERE owner_id=?").bind(capacity.owner.userId).first<{ n: number }>())?.n === 2, "저장 부족 뒤 quota 부분 커밋");
  checks.push("account-capacity-and-all-quota-reserved-atomically");
  await db.prepare("CREATE TRIGGER fixture_google_quota_failure BEFORE INSERT ON google_quota_charges WHEN NEW.owner_id='quota-fault' AND NEW.subject!='project' BEGIN SELECT RAISE(ABORT,'fixture_mid_batch_failure'); END").run();
  const fault = await fixtureGoogleConnection(db, "quota-fault", now);
  const faultPolicy = fixtureGoogleQuota(fault.owner.userId, now, 100, 100); await installGoogleQuotaPolicy(db, fault.owner, faultPolicy);
  const faultPlan = await prepareGoogleQuota(faultPolicy, { ...project, ownerId: fault.owner.userId }, fault.owner.userId, fault.connection.googleSubject, "drive.about.get", now);
  await rejected(() => reserveGoogleStorageProbe(db, fault.owner, fault.connection, faultPlan, { ...firstInput, attemptId: crypto.randomUUID() }), ["reference_conflict"]);
  ensure((await db.prepare("SELECT COUNT(*) AS n FROM google_requests WHERE owner_id=?").bind(fault.owner.userId).first<{ n: number }>())?.n === 0 && (await db.prepare("SELECT COUNT(*) AS n FROM google_quota_charges WHERE owner_id=?").bind(fault.owner.userId).first<{ n: number }>())?.n === 0, "중간 SQL 실패 부분 커밋");
  await db.prepare("DROP TRIGGER fixture_google_quota_failure").run();
  checks.push("injected-mid-batch-failure-leaves-no-request-or-quota");
  return checks;
}
