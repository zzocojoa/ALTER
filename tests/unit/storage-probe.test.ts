import { describe, expect, it, vi } from "vitest";
import { probeStorage } from "../../lib/storage-probe";
import type { StorageBindings } from "../../lib/storage-bindings";

function diagnosticBindings(first: ReturnType<typeof vi.fn>, put: ReturnType<typeof vi.fn>, get: ReturnType<typeof vi.fn>, remove: ReturnType<typeof vi.fn>): StorageBindings {
  return { DB: { prepare: () => ({ first }), batch: vi.fn() }, BUCKET: { put, get, delete: remove } } as unknown as StorageBindings;
}

describe("저장소 진단 실패", () => {
  it("D1 조회 실패 시 R2를 건드리지 않고 마지막 오류를 반환한다", async () => {
    const failure: Error = new Error("D1 unavailable");
    const first = vi.fn().mockRejectedValue(failure);
    const put = vi.fn();
    const get = vi.fn();
    const remove = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(probeStorage(diagnosticBindings(first, put, get, remove))).rejects.toBe(failure);
    expect(first).toHaveBeenCalledTimes(3);
    for (const operation of [put, get, remove]) expect(operation).not.toHaveBeenCalled();
  });
  it("쓰기와 정리의 동시 실패에서도 최초 원인을 잃지 않는다", async () => {
    const writeFailure: Error = new Error("put unavailable");
    const cleanupFailure: Error = new Error("delete unavailable");
    const put = vi.fn().mockRejectedValue(writeFailure);
    const remove = vi.fn().mockRejectedValue(cleanupFailure);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = probeStorage(diagnosticBindings(vi.fn().mockResolvedValue(1), put, vi.fn(), remove));
    await expect(result).rejects.toMatchObject({ name: "AggregateError", errors: [writeFailure, cleanupFailure] });
    expect(put).toHaveBeenCalledTimes(3);
    expect(remove).toHaveBeenCalledTimes(3);
    expect(new Set(put.mock.calls.map((args) => args[0])).size).toBe(1);
  });
  it("정리가 성공하면 쓰기의 원래 오류를 그대로 보존한다", async () => {
    const failure: Error = new Error("write rejected");
    const put = vi.fn().mockRejectedValue(failure);
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(probeStorage(diagnosticBindings(vi.fn().mockResolvedValue(1), put, vi.fn(), remove))).rejects.toBe(failure);
    expect(remove).toHaveBeenCalledTimes(3);
  });
});
