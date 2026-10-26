import { describe, expect, it } from "vitest";
import { evolveTransfer, legacyUploadState } from "../../lib/materials/transfer-state";
import type { ContentFact, ObjectFact, TransferEvent, TransferSnapshot } from "../../lib/materials/transfer-state";
import { materialPolicy } from "../../lib/materials/policy";
import type { MaterialMetadata } from "../../lib/materials/policy";

const metadata: MaterialMetadata = { title: "교재", edition: "", role: "reference", kind: "text", filename: "교재.txt", mime: "text/plain", bytes: 10, sha256: "a".repeat(64) };
const reserved: TransferSnapshot = { state: "reserved", writeStatus: "not-started", multipartId: null, object: null, validation: null, failureCode: null, updatedAt: 0 };
const object: ObjectFact = { objectVersion: "v1", etag: "etag1", sha256: metadata.sha256, bytes: 10 };
const content: ContentFact = { ...object, kind: "text", pages: 1, policyVersion: materialPolicy.version };
const events: readonly TransferEvent[] = [{ type: "start" }, { type: "multipart-created", multipartId: "multipart" }, { type: "write-succeeded", object }, { type: "validate" }, { type: "content-verified", content }, { type: "register" }];
function replay(input: readonly TransferEvent[]): TransferSnapshot { return input.reduce((state: TransferSnapshot, event: TransferEvent, i: number): TransferSnapshot => evolveTransfer(state, event, metadata, i + 1), reserved); }

describe("자료 전송의 외부 쓰기와 DB 확정 계약", (): void => {
  it("R2 성공·내용 검증·자료 확정을 별도로 보존한다", (): void => {
    expect(replay(events.slice(0, 3)).state).toBe("stored");
    expect(legacyUploadState(replay(events.slice(0, 5)).state)).toBe("object-written");
    expect(replay(events)).toMatchObject({ state: "registered", writeStatus: "succeeded", object, validation: content });
    expect(reserved.state).toBe("reserved");
  });
  it("미확정 쓰기는 시간만 지나도 정리하거나 새 전송을 시작하지 못한다", (): void => {
    const unknown: TransferSnapshot = replay([...events.slice(0, 2), { type: "write-unknown", reason: "response-lost" }]);
    for (const event of [{ type: "cleanup" }, { type: "start" }, { type: "register" }, { type: "deleted" }] as const) expect(() => evolveTransfer(unknown, event, metadata, 9999999)).toThrow();
    expect(evolveTransfer(unknown, { type: "write-succeeded", object }, metadata, 10).state).toBe("stored");
  });
  it("multipart 식별자조차 없는 미확정 쓰기는 abort 성공으로 처리하지 않는다", (): void => {
    const unknown: TransferSnapshot = replay([{ type: "start" }, { type: "write-unknown", reason: "create-response-lost" }]);
    expect(() => evolveTransfer(unknown, { type: "write-aborted", reason: "no-id" }, metadata, 10)).toThrow();
  });
  it("multipart 저장 전 취소가 늦게 도착한 쓰기의 선점을 차단한다", (): void => {
    const unknown: TransferSnapshot = replay([{ type: "start" }, { type: "write-unknown", reason: "create-response-lost" }]);
    const cancelled: TransferSnapshot = evolveTransfer(unknown, { type: "cancel-before-parts" }, metadata, 10);
    expect(cancelled).toMatchObject({ state: "failed", writeStatus: "aborted", multipartId: null });
    expect(() => evolveTransfer(cancelled, { type: "multipart-created", multipartId: "late" }, metadata, 11)).toThrow();
    expect(() => evolveTransfer(replay(events.slice(0, 2)), { type: "cancel-before-parts" }, metadata, 10)).toThrow();
  });
  it("확인된 abort 후에도 삭제 확인 전에는 예약 상태를 유지한다", (): void => {
    const failed: TransferSnapshot = replay([...events.slice(0, 2), { type: "write-aborted", reason: "confirmed-abort" }]);
    expect(failed.state).toBe("failed");
    const cleaning: TransferSnapshot = evolveTransfer(failed, { type: "cleanup" }, metadata, 10);
    expect(evolveTransfer(cleaning, { type: "deleted" }, metadata, 11).state).toBe("discarded");
  });
  it("자료 확정과 삭제 확정 이후의 전이는 거부한다", (): void => {
    const registered: TransferSnapshot = replay(events);
    const discarded: TransferSnapshot = replay([{ type: "cleanup" }, { type: "deleted" }]);
    for (const final of [registered, discarded]) for (const event of events) expect(() => evolveTransfer(final, event, metadata, 100)).toThrow();
  });
  it("보존된 실패 JPEG는 원본 사실·예약을 유지하고 재검증 뒤에만 확정한다", (): void => {
    const jpegMetadata: MaterialMetadata = { ...metadata, kind: "image", mime: "image/jpeg", filename: "photo.jpeg" };
    const failed: TransferSnapshot = { ...replay(events.slice(0, 3)), state: "failed", failureCode: "content-or-object-invalid" };
    const validating: TransferSnapshot = evolveTransfer(failed, { type: "revalidate-jpeg" }, jpegMetadata, 10);
    expect(validating).toMatchObject({ state: "validating", object, failureCode: "content-or-object-invalid", validation: null });
    expect(() => evolveTransfer(validating, { type: "register" }, jpegMetadata, 11)).toThrow();
    for (const invalid of [{ ...failed, writeStatus: "unknown" as const }, { ...failed, object: null }, { ...failed, failureCode: "unconfirmed-write" }, { ...failed, object: { ...object, sha256: "b".repeat(64) } }, { ...failed, validation: content }]) expect(() => evolveTransfer(invalid, { type: "revalidate-jpeg" }, jpegMetadata, 10)).toThrow();
    expect(() => evolveTransfer(failed, { type: "revalidate-jpeg" }, metadata, 10)).toThrow();
  });
  it("PDF 디코더 수정 뒤 같은 원본·예약으로 재검증하며 미확정 쓰기와 해시 변경은 거부한다", (): void => {
    const pdfMetadata: MaterialMetadata = { ...metadata, kind: "pdf", mime: "application/pdf", filename: "book.pdf" };
    const failed: TransferSnapshot = { ...replay(events.slice(0, 3)), state: "failed", failureCode: "material_content_invalid:pdf:stream-decode-failed" };
    const validating: TransferSnapshot = evolveTransfer(failed, { type: "revalidate-pdf" }, pdfMetadata, 10);
    expect(validating).toMatchObject({ state: "validating", object, validation: null });
    expect(() => evolveTransfer(validating, { type: "register" }, pdfMetadata, 11)).toThrow();
    for (const invalid of [{ ...failed, writeStatus: "unknown" as const }, { ...failed, object: null }, { ...failed, failureCode: "material_hash_mismatch:stream" }, { ...failed, object: { ...object, sha256: "b".repeat(64) } }, { ...failed, validation: content }]) expect(() => evolveTransfer(invalid, { type: "revalidate-pdf" }, pdfMetadata, 10)).toThrow();
    expect(() => evolveTransfer(failed, { type: "revalidate-pdf" }, metadata, 10)).toThrow();
    expect(() => evolveTransfer(failed, { type: "revalidate-jpeg" }, pdfMetadata, 10)).toThrow();
  });
  it("다른 객체 버전·해시·페이지·유형의 검증 증거를 거부한다", (): void => {
    const validating: TransferSnapshot = replay(events.slice(0, 4));
    for (const invalid of [{ ...content, objectVersion: "v2" }, { ...content, etag: "other" }, { ...content, sha256: "b".repeat(64) }, { ...content, bytes: 11 }, { ...content, pages: 2 }, { ...content, kind: "pdf" as const }]) expect(() => evolveTransfer(validating, { type: "content-verified", content: invalid }, metadata, 10)).toThrow();
  });
  it("내용 검사 전 등록·체크섬 다른 R2 성공·중복 multipart를 거부한다", (): void => {
    expect(() => evolveTransfer(reserved, { type: "register" }, metadata, 1)).toThrow();
    const sending: TransferSnapshot = replay(events.slice(0, 2));
    expect(() => evolveTransfer(sending, { type: "write-succeeded", object: { ...object, sha256: "b".repeat(64) } }, metadata, 3)).toThrow();
    expect(() => evolveTransfer(sending, { type: "multipart-created", multipartId: "different" }, metadata, 3)).toThrow();
  });
});
