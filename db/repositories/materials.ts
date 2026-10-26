import { z } from "zod";
import { recordId, timestamp, version, domainFailure } from "../../lib/domain/contracts.ts";
import type { Command } from "../../lib/domain/contracts.ts";
import { executeAtomic, guardedUpdate } from "./atomic.ts";
import type { Receipt } from "./atomic.ts";

const materialInput = z.object({ id: recordId, courseId: recordId, title: z.string().min(1), origin: z.enum(["upload", "google"]), originalId: z.string().nullable(), modifiedAt: z.string().nullable() }).strict();
const uploadInput = z.object({ id: recordId, materialId: recordId, uploadId: recordId, expectedHash: z.string().regex(/^[0-9a-f]{64}$/), bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), recoveryAt: timestamp }).strict();
const pageInput = z.object({ id: recordId, materialId: recordId, uploadId: recordId, filePage: z.number().int().positive(), printedPage: z.string().nullable(), content: z.string() }).strict();
const sourceInput = z.object({ id: recordId, materialId: recordId, uploadId: recordId, pageId: recordId, filePage: z.number().int().positive(), printedPage: z.string().nullable(), spanStart: z.number().int().nonnegative(), spanEnd: z.number().int().positive(), evidence: z.string().min(1) }).strict().refine((value) => value.spanEnd > value.spanStart);
export type MaterialInput = z.infer<typeof materialInput>;
export type UploadInput = z.infer<typeof uploadInput>;
export type PageInput = z.infer<typeof pageInput>;
export type SourceInput = z.infer<typeof sourceInput>;
export type UploadObservation = Readonly<{ objectKey: string; uploadId: string; hash: string; bytes: number }> | null;
export type UploadRecovery = Readonly<{ state: "verified" | "missing" | "quarantined"; verifiedHash: string | null; deleteObject: false }>;

export function uploadObjectKey(input: UploadInput): string { return `learning/${input.materialId}/${input.uploadId}/${input.id}`; }

/** 객체 존재와 메타데이터 일치는 별도로 확인하며 불명 객체를 자동 삭제하지 않습니다. */
export function reconcileUpload(input: UploadInput, observed: UploadObservation): UploadRecovery {
  uploadInput.parse(input);
  if (observed === null) return { state: "missing", verifiedHash: null, deleteObject: false };
  if (observed.objectKey !== uploadObjectKey(input) || observed.uploadId !== input.uploadId) throw domainFailure("reference_conflict", "upload.reconcile", null);
  if (observed.hash !== input.expectedHash || observed.bytes !== input.bytes) return { state: "quarantined", verifiedHash: observed.hash, deleteObject: false };
  return { state: "verified", verifiedHash: observed.hash, deleteObject: false };
}
export async function createMaterial(db: D1Database, context: Command, value: MaterialInput): Promise<Receipt> {
  const input: MaterialInput = materialInput.parse(value);
  return executeAtomic(db, context, "material.create", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO materials VALUES (?,?,1,?,?,?,?,?,?)").bind(context.owner.userId, input.id, requestId, input.courseId, input.title, input.origin, input.originalId, input.modifiedAt)]);
}
export async function reserveUpload(db: D1Database, context: Command, value: UploadInput): Promise<Receipt> {
  const input: UploadInput = uploadInput.parse(value);
  return executeAtomic(db, context, "upload.reserve", input, input.id, 1, (requestId: string) => [db.prepare("INSERT INTO uploads VALUES (?,?,1,?,?,?,?,'reserved',?,NULL,?,?)").bind(context.owner.userId, input.id, requestId, input.materialId, uploadObjectKey(input), input.uploadId, input.expectedHash, input.bytes, input.recoveryAt)]);
}
export async function recordUploadObservation(db: D1Database, context: Command, input: UploadInput, observed: UploadObservation): Promise<Receipt> {
  const result: UploadRecovery = reconcileUpload(input, observed);
  version.parse(context.expectedVersion);
  return executeAtomic(db, context, "upload.reconcile", { input, observed }, input.id, context.expectedVersion + 1, (requestId: string) => guardedUpdate(db, "uploads", context.owner.userId, input.id, context.expectedVersion, requestId, 0, "state = ?, verified_hash = ?", [result.state, result.verifiedHash], "material_id = ? AND upload_id = ? AND object_key = ? AND expected_hash = ? AND bytes = ?", [input.materialId, input.uploadId, uploadObjectKey(input), input.expectedHash, input.bytes]));
}
export async function createPage(db: D1Database, context: Command, value: PageInput): Promise<Receipt> {
  const input: PageInput = pageInput.parse(value);
  return executeAtomic(db, context, "page.create", input, input.id, 1, () => [db.prepare("INSERT INTO material_pages (owner_id,id,material_id,upload_id,file_page,printed_page,content) VALUES (?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.materialId, input.uploadId, input.filePage, input.printedPage, input.content)]);
}
export async function createSourceReference(db: D1Database, context: Command, value: SourceInput): Promise<Receipt> {
  const input: SourceInput = sourceInput.parse(value);
  return executeAtomic(db, context, "source.create", input, input.id, 1, () => [db.prepare("INSERT INTO source_references VALUES (?,?,?,?,?,?,?,?,?,?)").bind(context.owner.userId, input.id, input.materialId, input.uploadId, input.pageId, input.filePage, input.printedPage, input.spanStart, input.spanEnd, input.evidence)]);
}
