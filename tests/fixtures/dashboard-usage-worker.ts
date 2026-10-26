import { readUsageDashboard } from "../../db/repositories/dashboard-usage";
import { createCostWindow, reserveCost, settleCost, markCostUnknown, seoulMonthWindow } from "../../db/repositories/usage";
import { fixtureGoogleConnection } from "./google-connected";
import { fixtureGoogleQuota, fixtureGoogleStorage } from "./google-quota";
import { fixtureGoogleProject } from "./google-project";
import { fixtureFunding, fixturePrepaidProbe } from "./ai-funding";
import { fixturePricing } from "./ai-pricing";
import { installGoogleQuotaPolicy, reserveGoogleRequest, beginGoogleRequest, finishGoogleRequest } from "../../db/repositories/google-quota";
import { recordGoogleProviderBlock } from "../../db/repositories/google-observations";
import { prepareGoogleQuota } from "../../lib/google/quota";
import { recordId } from "../../lib/domain/contracts";
import type { Command } from "../../lib/domain/contracts";
import { isDomainFailure } from "../../db/repositories/atomic";
function check(value: boolean, message: string): void { if (!value) throw new Error(message); }
export async function verifyUsageDashboard(db: D1Database, now: number): Promise<readonly string[]> {
  const { owner, connection } = await fixtureGoogleConnection(db, "usage-owner", now);
  const cmd = (expectedVersion: number): Command => ({ owner, requestKey: crypto.randomUUID(), expectedVersion });
  const id = (): ReturnType<typeof recordId.parse> => recordId.parse(crypto.randomUUID());
  const windowId = id(); const firstId = id(); const unknownId = id();
  await createCostWindow(db, cmd(1), { id: windowId, category: "ai", ...seoulMonthWindow(now) });
  await reserveCost(db, cmd(1), { id: firstId, windowId, businessKey: "settled", model: "gpt-6-luna", amountUnits: 500_000, now });
  await settleCost(db, cmd(1), { reservationId: firstId, windowId, windowVersion: 2, actualUnits: 400_000, providerReceipt: "fixture", occurredAt: now });
  await reserveCost(db, cmd(3), { id: unknownId, windowId, businessKey: "unknown", model: "gpt-6-luna", amountUnits: 200_000, now });
  await markCostUnknown(db, cmd(1), unknownId);
  const quota = { ...fixtureGoogleQuota(owner.userId, now, 100, 100), pickerUsage: { accounting: "browser-sessions-only" as const, projectSessionsPerMinute: 3, userSessionsPerMinute: 2, provider: { queriesPerMinutePerUser: 250, enforcement: "google" as const, measuredQueries: null, consoleSource: "https://console.cloud.google.com/apis/api/picker.googleapis.com/quotas?project=alter-fixture-project", checkedAt: now, validUntil: now + 60_000 } } };
  const project = { ...fixtureGoogleProject(now), ownerId: owner.userId, projectId: quota.projectId, consoleSource: `https://console.cloud.google.com/apis/dashboard?project=${quota.projectId}` };
  await installGoogleQuotaPolicy(db, owner, quota);
  const plan = await prepareGoogleQuota(quota, project, owner.userId, connection.googleSubject, "drive.about.get", now);
  for (const state of ["succeeded", "failed", "reserved"] as const) {
    const attemptId = id(); const requestHash = "c".repeat(64);
    await reserveGoogleRequest(db, owner, connection, plan, { attemptId, requestHash, storageBytes: 0, now }, fixtureGoogleStorage(owner.userId, connection.googleSubject, now));
    if (state !== "reserved") { await beginGoogleRequest(db, owner, attemptId, requestHash, now); await finishGoogleRequest(db, owner, attemptId, { state, status: state === "succeeded" ? 200 : 429, errorCode: null, externalId: null, now }); }
  }
  await recordGoogleProviderBlock(db, owner, plan, "quota", 429, null, now);
  const config = { ...fixturePrepaidProbe(fixtureFunding(owner.userId, fixturePricing().id, now), fixturePricing()), support: [] };
  const before = await db.prepare("SELECT count(*) AS n FROM atomic_requests").first<number>("n");
  const data = await readUsageDashboard(db, owner, JSON.stringify(config), now);
  check(data.ai.windows[0].settled === 400_000 && data.ai.windows[0].reserved === 200_000 && data.ai.windows[0].unknown === 200_000 && data.ai.windows[0].remaining === 6_999_400_000, "정산과 미확정 예약 합계 불일치");
  check(data.google.methods[0].reservations === 3 && data.google.methods[0].sent === 2 && data.google.methods[0].succeeded === 1 && data.google.methods[0].failed === 1 && data.google.methods[0].unknown === 1, "초기·재시도·미전송 집계 오류");
  check(data.google.limits.every(item => item.appCharged === 15) && data.google.pickerQueries === null && data.google.pickerLimits[0].queriesPerMinutePerUser === 250 && data.google.blocks.length === 1, "quota와 실제 요청 단위 분리 실패");
  check(data.platform.material === null && data.google.storage === null && data.ai.funding?.pendingPayment?.status === "pending", "미확인 관측 또는 결제 왜곡");
  check((await db.prepare("SELECT count(*) AS n FROM atomic_requests").first<number>("n")) === before, "사용량 읽기에 쓰기 발생");
  check(!/fixture-access|fixture-refresh|Fingerprint|ciphertext/.test(JSON.stringify(data)), "사용량에 인증 정보 유출");
  await installGoogleQuotaPolicy(db, owner, { ...quota, version: 2 });
  const renewed = await readUsageDashboard(db, owner, undefined, now);
  check(renewed.google.blocks.length === 0 && renewed.google.limits.every(item => item.appCharged === 15), "새 정책에서 이전 차단 또는 예약 초기화");
  const expired = await readUsageDashboard(db, owner, JSON.stringify(config), now + 86_400_000);
  check(!expired.ai.funding?.current && expired.google.limits.every(item => !item.current) && !expired.google.pickerLimits[0].current, "만료 근거 정상 표시");
  const other = await readUsageDashboard(db, { realm: "sites", userId: "usage-other" }, JSON.stringify(config), now);
  check(other.ai.configuration === "owner-mismatch" && other.ai.windows.length === 0 && other.google.methods.length === 0 && other.google.connection === null, "사용량 소유자 격리 실패");
  const badDb: D1Database = new Proxy(db, { get(target, property, receiver): unknown { if (property === "prepare") return (): never => { throw new Error("fixture storage unavailable"); }; return Reflect.get(target, property, receiver); } });
  let rejected: boolean = false;
  try { await readUsageDashboard(badDb, owner, undefined, now); } catch (error: unknown) { if (!isDomainFailure(error) || error.code !== "storage_failure") throw error; rejected = true; }
  check(rejected, "저장소 실패를 사용량 0으로 표시함");
  return ["usage-cost-settled-reserved-unknown", "usage-google-sent-retry-reservation-accounting", "usage-quota-dimensions-preserved-across-policy", "usage-unknown-not-zero", "usage-pending-invoice-not-final-bill", "usage-read-only-no-secret", "usage-expiry-and-owner-isolation", "usage-storage-failure-not-empty"];
}
