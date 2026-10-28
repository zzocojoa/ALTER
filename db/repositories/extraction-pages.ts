import { z } from "zod";
import { domainFailure, recordId } from "../../lib/domain/contracts.ts";
import type { Command, SiteIdentity } from "../../lib/domain/contracts.ts";
import { storedExtractionPage } from "../../lib/extraction/state.ts";
import type { ImageMetadata, StoredExtractionPage } from "../../lib/extraction/state.ts";
import { validatePageResult } from "../../lib/extraction/result.ts";
import type { PageResult } from "../../lib/extraction/result.ts";
import type { VerifiedExtractionPage } from "../../lib/extraction/server.ts";
import { correctedPage, correctionInput } from "../../lib/extraction/confirmation.ts";
import type { CorrectionInput } from "../../lib/extraction/confirmation.ts";
import { initialTranscription, transcriptionEntry, transcriptionInput } from "../../lib/extraction/transcription.ts";
import type { TranscriptionInput } from "../../lib/extraction/transcription.ts";
import { executeAtomic, guardedUpdate, readStorage, requireInBatch } from "./atomic.ts";
import type { Receipt, SqlValue } from "./atomic.ts";

type PageRow = Omit<StoredExtractionPage, "pendingImage" | "resultImage" | "result" | "confirmedSegmentIds"> & Readonly<{ pendingImage: string | null; resultImage: string | null; result: string | null; confirmedSegmentIds: string }>;
const pageColumns: string = "p.id,p.job_id AS jobId,p.selection_revision AS selectionRevision,p.file_page AS filePage,p.version,p.result_version AS resultVersion,p.result_id AS resultId,p.state,p.printed_page AS printedPage,p.pending_ai_key AS pendingAiKey,p.pending_image AS pendingImage,r.image AS resultImage,p.failure,r.result,COALESCE((SELECT json_group_array(c.segment_id) FROM extraction_confirmations c WHERE c.owner_id=p.owner_id AND c.result_id=p.result_id),'[]') AS confirmedSegmentIds";
function parsePage(row: PageRow): StoredExtractionPage { return storedExtractionPage.parse({ ...row, resultImage: row.resultImage === null ? null : JSON.parse(row.resultImage), confirmedSegmentIds: JSON.parse(row.confirmedSegmentIds), pendingImage: row.pendingImage === null ? null : JSON.parse(row.pendingImage), result: row.result === null ? null : JSON.parse(row.result) }); }
export async function listExtractionPages(db: D1Database, owner: SiteIdentity, jobId: string, revision: number): Promise<readonly StoredExtractionPage[]> {
  const rows = await readStorage("extraction.pages", () => db.prepare(`SELECT ${pageColumns} FROM extraction_pages p LEFT JOIN extraction_results r ON r.owner_id=p.owner_id AND r.id=p.result_id WHERE p.owner_id=? AND p.job_id=? AND p.selection_revision=? ORDER BY p.file_page`).bind(owner.userId, jobId, revision).all<PageRow>());
  return rows.results.map(parsePage);
}
export async function getExtractionPage(db: D1Database, owner: SiteIdentity, id: string): Promise<StoredExtractionPage> {
  recordId.parse(id);
  const row: PageRow | null = await readStorage("extraction.page", () => db.prepare(`SELECT ${pageColumns} FROM extraction_pages p LEFT JOIN extraction_results r ON r.owner_id=p.owner_id AND r.id=p.result_id WHERE p.owner_id=? AND p.id=?`).bind(owner.userId, id).first<PageRow>());
  if (row === null) throw domainFailure("reference_conflict", "extraction.page", null);
  return parsePage(row);
}

/** 현재 선택과 검증 원본을 같은 D1 batch에서 다시 검사합니다. */
export function extractionSelectionGuard(db: D1Database, proof: VerifiedExtractionPage, requestId: string): D1PreparedStatement {
  return requireInBatch(db, proof.owner.userId, requestId, 0, "EXISTS(SELECT 1 FROM extraction_jobs j JOIN material_files f ON f.owner_id=j.owner_id AND f.material_id=j.id JOIN material_transfers t ON t.owner_id=f.owner_id AND t.id=f.transfer_id JOIN uploads u ON u.owner_id=t.owner_id AND u.id=t.id WHERE j.owner_id=? AND j.id=? AND j.version=? AND j.upload_id=? AND t.id=j.upload_id AND t.state='registered' AND u.state='verified' AND t.object_version=? AND t.actual_hash=? AND EXISTS(SELECT 1 FROM json_each(j.selection,'$.pages') WHERE json_extract(value,'$.filePage')=?))", [proof.owner.userId, proof.job.jobId, proof.job.revision, proof.transfer.id, proof.job.selection.originalVersion, proof.job.selection.originalHash, proof.filePage]);
}
export function requireExtractionPageBinding(page: StoredExtractionPage, proof: VerifiedExtractionPage, context: Command): void {
  if (page.jobId !== proof.job.jobId || page.selectionRevision !== proof.job.revision || page.filePage !== proof.filePage || context.owner.userId !== proof.owner.userId) throw domainFailure("reference_conflict", "extraction.page.binding", null);
}

function pageResultWrites(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, result: PageResult, image: ImageMetadata | null, aiCallId: string | null, condition: string, values: readonly SqlValue[], requestId: string): readonly D1PreparedStatement[] {
  requireExtractionPageBinding(page, proof, context); validatePageResult(result, page.filePage);
  const resultId: string = crypto.randomUUID();
  return [
    extractionSelectionGuard(db, proof, requestId),
    ...guardedUpdate(db, "extraction_pages", context.owner.userId, page.id, context.expectedVersion, requestId, 1, "result_version=result_version+1,result_id=?,state=?,failure=?,pending_ai_key=NULL,pending_image=NULL,updated_at=?", [resultId, result.status === "failed" ? "failed" : "complete", result.error, Date.now()], condition, values),
    db.prepare("INSERT INTO extraction_results (owner_id,id,page_id,result_version,upload_id,original_version,original_hash,result,image,ai_call_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(context.owner.userId, resultId, page.id, page.resultVersion + 1, proof.transfer.id, proof.job.selection.originalVersion, proof.job.selection.originalHash, JSON.stringify(result), image === null ? null : JSON.stringify(image), aiCallId, Date.now()),
  ];
}
async function commitPageResult(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, result: PageResult, image: ImageMetadata | null, aiCallId: string | null, condition: string, values: readonly SqlValue[]): Promise<Receipt> {
  requireExtractionPageBinding(page, proof, context); validatePageResult(result, page.filePage);
  return executeAtomic(db, context, "extraction.result", { pageId: page.id, result, image, aiCallId }, page.id, context.expectedVersion + 1, (requestId: string): readonly D1PreparedStatement[] => pageResultWrites(db, context, proof, page, result, image, aiCallId, condition, values, requestId));
}

export async function saveTextExtraction(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, value: PageResult): Promise<Receipt> {
  if (value.method === "vision") throw domainFailure("validation", "extraction.text.method", null);
  return commitPageResult(db, context, proof, page, value, null, null, "state NOT IN ('running','unknown')", []);
}

/** 새 생성 전에 페이지 의도를 먼저 남기며 리스 만료로 이 상태를 지우지 않습니다. */
export async function beginVisionExtraction(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, key: string, image: ImageMetadata): Promise<Receipt> {
  requireExtractionPageBinding(page, proof, context); z.string().min(1).max(180).parse(key);
  return executeAtomic(db, context, "extraction.vision.begin", { pageId: page.id, key, image }, page.id, context.expectedVersion + 1, (requestId: string) => [extractionSelectionGuard(db, proof, requestId), ...guardedUpdate(db, "extraction_pages", context.owner.userId, page.id, context.expectedVersion, requestId, 1, "state='running',pending_ai_key=?,pending_image=?,failure=NULL,updated_at=?", [key, JSON.stringify(image), Date.now()], "state NOT IN ('running','unknown')", [])]);
}

export async function completeVisionExtraction(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, result: PageResult, image: ImageMetadata, callId: string): Promise<Receipt> {
  if (result.method !== "vision" || page.pendingAiKey === null) throw domainFailure("validation", "extraction.vision.result", null);
  return commitPageResult(db, context, proof, page, result, image, callId, "state IN ('running','unknown') AND pending_ai_key=? AND EXISTS(SELECT 1 FROM ai_calls WHERE owner_id=? AND id=? AND logical_request_key=? AND stage='validated')", [page.pendingAiKey, context.owner.userId, callId, page.pendingAiKey]);
}

export async function recordVisionFailure(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, state: "unknown" | "failed", reason: string): Promise<Receipt> {
  requireExtractionPageBinding(page, proof, context); z.string().min(1).max(1000).parse(reason);
  return executeAtomic(db, context, "extraction.vision.failure", { pageId: page.id, state, reason }, page.id, context.expectedVersion + 1, (requestId: string) => [extractionSelectionGuard(db, proof, requestId), ...guardedUpdate(db, "extraction_pages", context.owner.userId, page.id, context.expectedVersion, requestId, 1, "state=?,failure=?,updated_at=?", [state, reason, Date.now()], "state IN ('running','unknown') AND pending_ai_key=?", [page.pendingAiKey])]);
}

/** 편집본은 새 결과 버전을 만들며 이전 확인 구간을 복사하지 않습니다. */
export async function saveExtractionCorrection(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, value: CorrectionInput): Promise<Receipt> {
  const input: CorrectionInput = correctionInput.parse(value);
  requireExtractionPageBinding(page, proof, context);
  if (context.expectedVersion !== input.expectedVersion) throw domainFailure("validation", "extraction.correction.version", null);
  return executeAtomic(db, context, "extraction.correction", { pageId: page.id, input }, page.id, context.expectedVersion + 1, (requestId: string): readonly D1PreparedStatement[] => {
    const result: PageResult = correctedPage(page, input);
    return pageResultWrites(db, context, proof, page, result, page.resultImage, null, "state IN ('complete','failed') AND result_id=?", [input.resultId], requestId);
  });
}

/** 첫 전사는 결과 없음 또는 실패한 빈 결과에만 저장하며 기존 결과 판은 이력으로 남깁니다. */
export async function saveInitialTranscription(db: D1Database, context: Command, proof: VerifiedExtractionPage, page: StoredExtractionPage, value: TranscriptionInput): Promise<Receipt> {
  const input: TranscriptionInput = transcriptionInput.parse(value);
  requireExtractionPageBinding(page, proof, context);
  if (context.expectedVersion !== input.expectedVersion || input.selectionRevision !== page.selectionRevision || input.filePage !== page.filePage) throw domainFailure("validation", "extraction.transcription.binding", null);
  const result: PageResult = initialTranscription(input);
  return executeAtomic(db, context, "extraction.transcription", { pageId: page.id, input }, page.id, context.expectedVersion + 1, (requestId: string): readonly D1PreparedStatement[] => {
    if (transcriptionEntry(page) !== "create" || page.resultId !== input.resultId) throw domainFailure("reference_conflict", "extraction.transcription.current-result", null);
    return pageResultWrites(db, context, proof, page, result, null, null, "state IN ('pending','failed') AND result_id IS ?", [input.resultId], requestId);
  });
}
