import type { Command } from "../../lib/domain/contracts.ts";
import type { VerifiedExtractionPage } from "../../lib/extraction/server.ts";
import type { StoredExtractionPage } from "../../lib/extraction/state.ts";
import { requireConfirmableSegments } from "../../lib/extraction/confirmation.ts";
import type { ConfirmationInput } from "../../lib/extraction/confirmation.ts";
import { executeAtomic, guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { extractionSelectionGuard, requireExtractionPageBinding } from "./extraction-pages.ts";

/** 확인 구간과 표시 쪽수를 CAS와 같은 트랜잭션에 저장합니다. */
export async function confirmExtractionSegments(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, input: ConfirmationInput): Promise<Receipt> {
  requireExtractionPageBinding(page, proof, context); requireConfirmableSegments(page, input);
  return executeAtomic(db, context, "extraction.confirm", { pageId: page.id, input }, page.id, context.expectedVersion + 1, (requestId: string) => [
    extractionSelectionGuard(db, proof, requestId),
    ...guardedUpdate(db, "extraction_pages", context.owner.userId, page.id, context.expectedVersion, requestId, 1, "printed_page=?,updated_at=?", [input.printedPage === "" ? null : input.printedPage, Date.now()], "state='complete' AND result_id=?", [input.resultId]),
    db.prepare("INSERT INTO extraction_confirmations (owner_id,result_id,segment_id,confirmed_at) SELECT ?,?,value,? FROM json_each(?) WHERE NOT EXISTS(SELECT 1 FROM extraction_confirmations c WHERE c.owner_id=? AND c.result_id=? AND c.segment_id=value)").bind(context.owner.userId, input.resultId, Date.now(), JSON.stringify(input.segmentIds), context.owner.userId, input.resultId),
  ]);
}

/** 표시 쪽수는 내용 버전이나 확인 구간과 별도로 변경합니다. */
export async function setExtractionPrintedPage(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, printedPage: string | null): Promise<Receipt> {
  requireExtractionPageBinding(page, proof, context);
  if (printedPage !== null && printedPage.length > 40) throw new RangeError("인쇄된 쪽수는 40자 이내로 입력해 주세요.");
  return executeAtomic(db, context, "extraction.printed-page", { pageId: page.id, printedPage }, page.id, context.expectedVersion + 1, (requestId: string) => [extractionSelectionGuard(db, proof, requestId), ...guardedUpdate(db, "extraction_pages", context.owner.userId, page.id, context.expectedVersion, requestId, 1, "printed_page=?,updated_at=?", [printedPage === "" ? null : printedPage, Date.now()], "1=1", [])]);
}
