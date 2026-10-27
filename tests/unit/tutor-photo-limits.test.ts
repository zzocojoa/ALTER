import { Miniflare } from "miniflare";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTutorAnswerImages } from "../../lib/tutor/images";
import type { StoredTransfer } from "../../db/repositories/material-transfers";
import { tutorStateFixture, tutorAnswerFixture, tutorId } from "../fixtures/tutor-state";

const mocks = vi.hoisted(() => ({ get: vi.fn<() => Promise<StoredTransfer>>(), read: vi.fn<() => Promise<Response>>(), head: vi.fn(), png: vi.fn(), hash: vi.fn() }));
vi.mock("../../lib/materials/download", () => ({ getRegisteredMaterial: mocks.get }));
vi.mock("../../lib/materials/object", () => ({ readMaterialObject: mocks.read, headMaterialObject: mocks.head }));
vi.mock("../../lib/materials/png-content", () => ({ validatePngContent: mocks.png }));
vi.mock("../../lib/materials/jpeg-content", () => ({ validateJpegContent: vi.fn() }));
vi.mock("../../lib/learning-upload", () => ({ hashFile: mocks.hash }));

function transfer(bytes: number): StoredTransfer {
  return { id: tutorId(101), materialId: tutorId(102), uploadId: tutorId(101), objectKey: "fixture", version: 3, courseId: tutorId(4), reservedAt: 1, metadata: { title: "사진", filename: "answer.png", edition: "", role: "answer", kind: "image", mime: "image/png", bytes, sha256: "a".repeat(64) }, snapshot: { state: "registered", writeStatus: "succeeded", multipartId: null, object: null, validation: null, failureCode: null, updatedAt: 1 } };
}
const worker = new Miniflare({ modules: true, script: "export default {fetch(){return new Response('fixture')}}", compatibilityDate: "2026-05-15", cf: false, d1Persist: false, r2Persist: false, d1Databases: ["DB"], r2Buckets: ["BUCKET"] });
const jpeg = new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
beforeEach((): void => { vi.resetAllMocks(); mocks.hash.mockResolvedValue("a".repeat(64)); mocks.png.mockResolvedValue({ image: { width: 1, height: 1 } }); });
afterEach(async (): Promise<void> => { await worker.dispose(); });

/** 판독 전 용량 검사를 분리하며 모의 객체에는 실제 이미지 판독이나 외부 호출이 없습니다. */
describe("원본 보관과 별도인 AI 사진 전달 한도", (): void => {
  it("사진당 2MiB와 합계 4MiB 경계를 넘기면 다음 원본 읽기 전에 중단한다", async (): Promise<void> => {
    const db = await worker.getD1Database("DB"); const bucket = await worker.getR2Bucket("BUCKET") as unknown as R2Bucket;
    for (const sizes of [[2097151], [2097152], [2097153], [2097152, 2097151], [2097152, 2097152], [2097152, 2097152, 1]]) {
      mocks.get.mockReset(); mocks.read.mockReset();
      for (const bytes of sizes) { mocks.get.mockResolvedValueOnce(transfer(bytes)); mocks.read.mockResolvedValueOnce(new Response(new Uint8Array(bytes))).mockResolvedValueOnce(new Response(new Uint8Array(bytes))); }
      const base = tutorStateFixture(); const answer = { ...tutorAnswerFixture(), fileIds: sizes.map((_bytes, index) => tutorId(102 + index)) };
      const state = { ...base, answers: [answer], currentAnswerId: answer.id, pending: { key: "fixture", kind: "tutor-diagnosis" as const } };
      const run = readTutorAnswerImages(db, bucket, { realm: "sites", userId: "owner-test" }, state, jpeg, new AbortController().signal);
      if (sizes.some((bytes): boolean => bytes > 2097152) || sizes.reduce((sum, bytes): number => sum + bytes, 0) > 4194304) {
        await expect(run).rejects.toMatchObject({ code: "limit_exceeded", operation: "tutor.ai-photo-2MiB-each-4MiB-total-original-retained" });
        expect(mocks.read).toHaveBeenCalledTimes(sizes.length === 1 ? 0 : 4);
      } else expect((await run).map((image) => image.bytes)).toEqual(sizes);
    }
  });
});
