import { z } from "zod";
import { recordId, siteIdentity } from "../../lib/domain/contracts.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { readStorage } from "./atomic.ts";
import type { AiCallRow } from "./ai-call.ts";

export type AiRequestState = Readonly<{ callId: string; attemptOrdinal: number | null; stage: AiCallRow["stage"] | null; reservationState: "reserved" | "unknown" | "settled" | "released"; reservationAmountUnits: number; outstandingReservedUnits: number; actualUnits: number | null; overrunUnits: number | null; periodStart: number; resetAt: number; responseId: string | null; failureCode: string | null; httpStatus: number | null; result: string | null; costKind: "usage-calculated"; currency: "KRW"; scale: 1000000; automaticReplayAllowed: false }>;

/** 리스 만료와 관계없이 조회만 하며 예약만 남은 전송 전 중단도 기존 요청으로 반환합니다. */
export async function readAiRequestStatus(db: D1Database, owner: SiteIdentity, logicalRequestKey: string): Promise<readonly AiRequestState[]> {
  siteIdentity.parse(owner); z.string().min(1).max(180).parse(logicalRequestKey);
  const rows = await readStorage("ai.status", () => db.prepare("SELECT r.id AS callId,c.attempt_ordinal AS attemptOrdinal,c.stage,r.state AS reservationState,r.amount_units AS reservationAmountUnits,CASE WHEN r.state IN ('reserved','unknown') THEN r.amount_units ELSE 0 END AS outstandingReservedUnits,r.actual_units AS actualUnits,b.actual_units AS overrunUnits,w.period_start AS periodStart,w.reset_at AS resetAt,c.response_id AS responseId,c.failure_code AS failureCode,c.http_status AS httpStatus,c.result FROM ai_cost_intents i JOIN cost_reservations r ON r.owner_id=i.owner_id AND r.id=i.id JOIN cost_windows w ON w.owner_id=r.owner_id AND w.id=r.window_id LEFT JOIN ai_calls c ON c.owner_id=i.owner_id AND c.id=i.id LEFT JOIN ai_budget_blocks b ON b.owner_id=r.owner_id AND b.reservation_id=r.id WHERE i.owner_id=? AND i.scope='openai.response' AND i.request_key IN (?,?,?) ORDER BY i.request_key").bind(owner.userId, `${logicalRequestKey}:1`, `${logicalRequestKey}:2`, `${logicalRequestKey}:3`).all<Omit<AiRequestState, "costKind" | "currency" | "scale" | "automaticReplayAllowed">>());
  return rows.results.map((row): AiRequestState => ({ ...row, costKind: "usage-calculated", currency: "KRW", scale: 1000000, automaticReplayAllowed: false }));
}

export async function readAiIntentForCall(db: D1Database, owner: SiteIdentity, callId: string): Promise<Readonly<{ scope: string; requestKey: string }> | null> {
  siteIdentity.parse(owner); recordId.parse(callId);
  return readStorage("ai.intent.lookup", () => db.prepare("SELECT scope,request_key AS requestKey FROM ai_cost_intents WHERE owner_id=? AND id=?").bind(owner.userId, callId).first());
}
