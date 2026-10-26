import { beforeEach, expect, test, vi } from "vitest";
import { hashFile, recoverLearningUpload, storeLearningUpload } from "@/lib/learning-upload";
import { command, recordId } from "@/lib/domain/contracts";
import type { UploadInput } from "@/db/repositories/materials";

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), observe: vi.fn() }));
vi.mock("../../db/repositories/materials.ts", async (importOriginal) => ({ ...await importOriginal<typeof import("../../db/repositories/materials")>(), reserveUpload: mocks.reserve, recordUploadObservation: mocks.observe }));
const context = command.parse({ owner: { realm: "sites", userId: "upload-owner" }, requestKey: "upload-1", expectedVersion: 1 });
const bytes: ArrayBuffer = new Uint8Array([1, 2, 3]).buffer;
const db = {} as D1Database;
beforeEach(() => { vi.clearAllMocks(); mocks.reserve.mockResolvedValue({}); mocks.observe.mockResolvedValue({ version: 2 }); });
async function input(): Promise<UploadInput> { return { id: recordId.parse("00000000-0000-4000-8000-000000000001"), materialId: recordId.parse("00000000-0000-4000-8000-000000000002"), uploadId: recordId.parse("00000000-0000-4000-8000-000000000003"), expectedHash: await hashFile(bytes), bytes: 3, recoveryAt: 1 }; }
function object(value: UploadInput): R2ObjectBody { return { key: `learning/${value.materialId}/${value.uploadId}/${value.id}`, size: 3, arrayBuffer: async () => bytes } as R2ObjectBody; }

test("D1 예약 실패 시 R2를 쓰지 않는다", async () => {
  mocks.reserve.mockRejectedValue(new Error("D1 unavailable"));
  const put = vi.fn();
  await expect(storeLearningUpload(db, { put } as unknown as R2Bucket, context, context, await input(), bytes)).rejects.toThrow("D1 unavailable");
  expect(put).not.toHaveBeenCalled();
});
test("R2 저장 응답 유실은 읽기로 확인하고 D1을 완료한다", async () => {
  const value: UploadInput = await input();
  const put = vi.fn().mockRejectedValue(new Error("response lost"));
  const get = vi.fn().mockResolvedValue(object(value));
  await storeLearningUpload(db, { put, get } as unknown as R2Bucket, context, context, value, bytes);
  expect(put).toHaveBeenCalledTimes(1); expect(mocks.observe).toHaveBeenCalledWith(db, context, value, expect.objectContaining({ hash: value.expectedHash }));
});
test("R2 이후 D1 실패는 객체를 보존하고 재조회로 복구한다", async () => {
  const value: UploadInput = await input();
  const put = vi.fn().mockResolvedValue(object(value)), get = vi.fn().mockResolvedValue(object(value)), remove = vi.fn();
  const bucket = { put, get, delete: remove } as unknown as R2Bucket;
  mocks.observe.mockRejectedValueOnce(new Error("D1 commit failed"));
  await expect(storeLearningUpload(db, bucket, context, context, value, bytes)).rejects.toThrow("D1 commit failed");
  await recoverLearningUpload(db, bucket, context, value);
  expect(put).toHaveBeenCalledTimes(1); expect(remove).not.toHaveBeenCalled();
});
test("메타데이터만 존재하면 missing을 기록하고 성공으로 표시하지 않는다", async () => {
  const value: UploadInput = await input();
  await expect(recoverLearningUpload(db, { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket, context, value)).rejects.toThrow("reference_conflict");
  expect(mocks.observe).toHaveBeenCalledWith(db, context, value, null);
});
test("다른 업로드 키는 수정하거나 삭제하지 않는다", async () => {
  const value: UploadInput = await input(); const remove = vi.fn();
  await expect(recoverLearningUpload(db, { get: vi.fn().mockResolvedValue({ ...object(value), key: "another-upload" }), delete: remove } as unknown as R2Bucket, context, value)).rejects.toThrow("reference_conflict");
  expect(remove).not.toHaveBeenCalled(); expect(mocks.observe).not.toHaveBeenCalled();
});
