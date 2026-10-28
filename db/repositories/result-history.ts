import { requireReviewVisibility } from "./review-overview.ts";
import type { SiteIdentity } from "../../lib/domain/contracts.ts";
import { resultHistoryItem, type ResultHistoryItem } from "../../lib/results/history.ts";
import { readStorage } from "./atomic.ts";

/** 소유자의 최근 회차와 실제 확정 이력만 연결하며 답안 본문은 목록에 포함하지 않습니다. */
export async function readResultHistory(db: D1Database, owner: SiteIdentity): Promise<readonly ResultHistoryItem[]> {
  await requireReviewVisibility(db, owner);
  const rows = await readStorage("result.history", () => db.prepare("SELECT t.id,t.version,json_extract(t.state,'$.start.bundle.unit.title') AS title,r.ordinal AS confirmedOrdinal,c.confirmed_at AS confirmedAt FROM tutor_sessions t LEFT JOIN session_confirmations c ON c.owner_id=t.owner_id AND c.session_id=t.id LEFT JOIN confirmed_results r ON r.owner_id=c.owner_id AND r.id=c.result_version_id WHERE t.owner_id=? AND json_extract(t.state,'$.phase') IN ('answer-saved','diagnosed','finished') ORDER BY t.rowid DESC LIMIT 30").bind(owner.userId).all());
  await requireReviewVisibility(db, owner);
  return rows.results.map((row): ResultHistoryItem => resultHistoryItem.parse(row));
}
