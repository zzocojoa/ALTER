import { domainFailure, recordId, siteIdentity } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { createCostWindow, seoulMonthWindow } from "./usage.ts";
import { isDomainFailure, readStorage } from "./atomic.ts";

export type AiWindow = Readonly<{ id: string; version: number; reservedUnits: number; settledUnits: number; limitUnits: number; periodStart: number; resetAt: number }>;
/** 시도 직전 서울 월을 읽으며 지난달 불명 예약은 갱신하거나 해제하지 않습니다. */
export async function currentAiWindow(db: D1Database, owner: SiteIdentity, now: number): Promise<AiWindow> {
  siteIdentity.parse(owner);
  const period = seoulMonthWindow(now);
  const read = (): Promise<AiWindow | null> => readStorage("ai.window", () => db.prepare("SELECT id,version,reserved_units AS reservedUnits,settled_units AS settledUnits,limit_units AS limitUnits,period_start AS periodStart,reset_at AS resetAt FROM cost_windows WHERE owner_id=? AND category='ai' AND period_start=? AND reset_at=?").bind(owner.userId, period.periodStart, period.resetAt).first<AiWindow>());
  const existing: AiWindow | null = await read();
  if (existing) return existing;
  try { await createCostWindow(db, { owner, requestKey: crypto.randomUUID(), expectedVersion: 1 }, { id: recordId.parse(crypto.randomUUID()), category: "ai", ...period }); }
  catch (error: unknown) {
    if (!isDomainFailure(error) || error.code !== "reference_conflict") throw error;
    const raced: AiWindow | null = await read();
    if (raced) return raced;
    throw error;
  }
  const created: AiWindow | null = await read();
  if (!created) throw domainFailure("result_unknown", "ai.window", null);
  return created;
}
