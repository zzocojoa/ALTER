import { domainFailure, recordId } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { judgeExtractionSource, segmentSpans } from "../../lib/extraction/source.ts";
import type { ExtractionSource, SourceJudgment, SourceSnapshot } from "../../lib/extraction/source.ts";
import type { StoredExtractionPage } from "../../lib/extraction/state.ts";
import type { VerifiedExtractionPage } from "../../lib/extraction/server.ts";
import { executeAtomic, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";
import { extractionSelectionGuard, getExtractionPage, requireExtractionPageBinding } from "./extraction-pages.ts";

export function extractionSourceSnapshot(proof: VerifiedExtractionPage, page: StoredExtractionPage): SourceSnapshot {
  return { ownerId: proof.owner.userId, materialId: proof.job.jobId, uploadId: proof.transfer.id, originalVersion: proof.job.selection.originalVersion, originalHash: proof.job.selection.originalHash, selectionRevision: proof.job.revision, page };
}

/** 확인한 구간마다 하나의 불변 출처를 만들고 현재 버전 조건을 같은 batch에서 검사합니다. */
export async function createExtractionSource(db: D1Database, command: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, segmentId: string): Promise<Receipt> {
  requireExtractionPageBinding(page, proof, command);
  if (page.result === null || page.resultId === null) throw domainFailure("reference_conflict", "source.deleted", null);
  const span = segmentSpans(page.result).find((item): boolean => item.segment.id === segmentId);
  if (span === undefined) throw domainFailure("reference_conflict", "source.segment-missing", null);
  const id: string = crypto.randomUUID();
  const source: ExtractionSource = { id: recordId.parse(id), ownerId: command.owner.userId, materialId: recordId.parse(page.jobId), uploadId: recordId.parse(proof.transfer.id), pageId: recordId.parse(page.resultId), extractionPageId: page.id, filePage: page.filePage, printedPage: page.printedPage, spanStart: span.start, spanEnd: span.end, evidence: span.segment.text, originalVersion: proof.job.selection.originalVersion, originalHash: proof.job.selection.originalHash, selectionRevision: page.selectionRevision, resultVersion: page.resultVersion, segmentId };
  const judgment: SourceJudgment = judgeExtractionSource(source, extractionSourceSnapshot(proof, page));
  if (!judgment.valid) throw domainFailure("reference_conflict", `source.${judgment.reason}`, null);
  return executeAtomic(db, command, "extraction.source", { pageId: page.id, resultId: page.resultId, segmentId }, page.id, page.version, (requestId: string) => [
    extractionSelectionGuard(db, proof, requestId),
    requireInBatch(db, command.owner.userId, requestId, 1, "EXISTS(SELECT 1 FROM extraction_pages p JOIN extraction_confirmations c ON c.owner_id=p.owner_id AND c.result_id=p.result_id WHERE p.owner_id=? AND p.id=? AND p.version=? AND p.result_id=? AND p.state='complete' AND c.segment_id=?)", [command.owner.userId, page.id, command.expectedVersion, page.resultId, segmentId]),
    db.prepare("INSERT INTO material_pages (owner_id,id,material_id,upload_id,file_page,printed_page,content,result_version) SELECT ?,?,?,?,?,?,?,COALESCE((SELECT MAX(result_version)+1 FROM material_pages WHERE owner_id=? AND upload_id=? AND file_page=?),1) WHERE NOT EXISTS(SELECT 1 FROM material_pages WHERE owner_id=? AND id=?)").bind(command.owner.userId, page.resultId, source.materialId, source.uploadId, page.filePage, page.printedPage, judgment.page.content, command.owner.userId, source.uploadId, page.filePage, command.owner.userId, page.resultId),
    db.prepare("INSERT INTO source_references (owner_id,id,material_id,upload_id,page_id,file_page,printed_page,span_start,span_end,evidence) SELECT ?,?,?,?,?,?,p.printed_page,?,?,? FROM material_pages p WHERE p.owner_id=? AND p.id=? AND NOT EXISTS(SELECT 1 FROM extraction_sources WHERE owner_id=? AND result_id=? AND segment_id=?)").bind(command.owner.userId, id, source.materialId, source.uploadId, page.resultId, page.filePage, span.start, span.end, span.segment.text, command.owner.userId, page.resultId, command.owner.userId, page.resultId, segmentId),
    db.prepare("INSERT INTO extraction_sources (owner_id,source_id,result_id,segment_id) SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM source_references WHERE owner_id=? AND id=?)").bind(command.owner.userId, id, page.resultId, segmentId, command.owner.userId, id),
    requireInBatch(db, command.owner.userId, requestId, 2, "EXISTS(SELECT 1 FROM extraction_sources WHERE owner_id=? AND result_id=? AND segment_id=?)", [command.owner.userId, page.resultId, segmentId]),
  ]);
}

export async function readExtractionSource(db: D1Database, owner: SiteIdentity, id: string): Promise<ExtractionSource | null> {
  recordId.parse(id);
  return readStorage("extraction.source.read", () => db.prepare("SELECT s.id,s.owner_id AS ownerId,s.material_id AS materialId,s.upload_id AS uploadId,s.page_id AS pageId,s.file_page AS filePage,s.printed_page AS printedPage,s.span_start AS spanStart,s.span_end AS spanEnd,s.evidence,e.segment_id AS segmentId,r.original_version AS originalVersion,r.original_hash AS originalHash,r.result_version AS resultVersion,r.page_id AS extractionPageId,p.selection_revision AS selectionRevision FROM source_references s JOIN extraction_sources e ON e.owner_id=s.owner_id AND e.source_id=s.id JOIN extraction_results r ON r.owner_id=e.owner_id AND r.id=e.result_id JOIN extraction_pages p ON p.owner_id=r.owner_id AND p.id=r.page_id WHERE s.owner_id=? AND s.id=?").bind(owner.userId, id).first<ExtractionSource>());
}

export async function judgeStoredExtractionSource(db: D1Database, proof: VerifiedExtractionPage, source: ExtractionSource): Promise<SourceJudgment> {
  const page = await getExtractionPage(db, proof.owner, source.extractionPageId);
  return judgeExtractionSource(source, extractionSourceSnapshot(proof, page));
}
