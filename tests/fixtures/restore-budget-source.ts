import { command, recordId } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { fundingSnapshot } from "../../lib/ai/funding.ts";
import { markCostUnknown, reserveCost } from "../../db/repositories/usage.ts";

/** 과거 백업과 현재 원장에 서로 다른 예약을 만들며 제공사에는 요청하지 않습니다. */
export async function reserveRestoreBudgetFixture(db: D1Database, owner: SiteIdentity, businessKey: string, usdMicros: number, now: number): Promise<void> {
  const prior = await db.prepare("SELECT snapshot FROM ai_funding_checks WHERE owner_id=? LIMIT 1").bind(owner.userId).first<string>("snapshot");
  const window = await db.prepare("SELECT id,version FROM cost_windows WHERE owner_id=? AND category='ai' AND period_start<=? AND reset_at>?").bind(owner.userId, now, now).first<{ id: string; version: number }>();
  if (prior === null || window === null) throw new Error("비용 복원 시험의 기존 자금·월 원장이 없습니다.");
  const id = recordId.parse(crypto.randomUUID());
  await reserveCost(db, command.parse({ owner, requestKey: crypto.randomUUID(), expectedVersion: window.version }), { id, windowId: recordId.parse(window.id), businessKey, model: "gpt-6-luna", amountUnits: 0, now });
  await markCostUnknown(db, command.parse({ owner, requestKey: crypto.randomUUID(), expectedVersion: 1 }), id);
  const snapshot = fundingSnapshot.parse({ ...JSON.parse(prior), id: crypto.randomUUID(), ownerId: owner.userId, reservationUsdMicros: usdMicros, prepaidProbe: { limitUsdMicros: 50_000, creditAvailableUsdMicros: 5_000_000, additionalPurchasesAllowed: false, pendingPayment: { id: "restore-pending-invoice", paidUsdMicros: 5_500_000, paidAt: now, krwStatus: "pending", reservedKrwUnits: 10_000_000_000 } }, checkedAt: now, validUntil: now + 86_400_000 });
  await db.prepare("INSERT INTO ai_funding_checks VALUES (?,?,?,?)").bind(owner.userId, id, JSON.stringify(snapshot), now).run();
}
