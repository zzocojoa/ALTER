import { describe, expect, it, vi } from "vitest";
import { createPrivateObject, readPrivateObject, deletePrivateObject } from "../../lib/r2-access";

const payload: ArrayBuffer = new Uint8Array([1, 2, 3]).buffer;

function storedObject(): R2ObjectBody {
  return { size: 3, arrayBuffer: async () => payload } as R2ObjectBody;
}

describe("R2 불명확한 쓰기 결과", () => {
  it("서버 반영 후 응답이 끊기면 재조회로 확인하고 쓰기를 반복하지 않는다", async () => {
    const object: R2ObjectBody = storedObject();
    const put = vi.fn().mockRejectedValue(new Error("response lost"));
    const get = vi.fn().mockResolvedValue(object);
    const bucket = { put, get } as unknown as R2Bucket;
    expect(await createPrivateObject(bucket, "private/test", payload)).toBe(object);
    expect(put).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("재조회도 실패하면 미실행으로 간주하지 않으며 마지막 읽기 오류를 전달한다", async () => {
    const failure: Error = new Error("read unavailable");
    const put = vi.fn().mockRejectedValue(new Error("response lost"));
    const get = vi.fn().mockRejectedValue(failure);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(createPrivateObject({ put, get } as unknown as R2Bucket, "private/test", payload)).rejects.toBe(failure);
    expect(put).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(3);
    expect(warning).toHaveBeenCalledWith(expect.objectContaining({ event: "r2_retry", operation: "get" }));
  });
  it("부재를 확인한 경우에만 같은 키로 재시도한다", async () => {
    const object: R2ObjectBody = storedObject();
    const put = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(object);
    const get = vi.fn().mockResolvedValue(null);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await createPrivateObject({ put, get } as unknown as R2Bucket, "private/test", payload)).toBe(object);
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0]).toEqual(put.mock.calls[1]);
  });
  it("삭제의 성공 응답만 믿지 않고 실제 부재를 확인한다", async () => {
    const get = vi.fn().mockResolvedValue(storedObject());
    const remove = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await expect(deletePrivateObject({ get, delete: remove } as unknown as R2Bucket, "private/test")).rejects.toThrow("객체가 남아");
    expect(remove).toHaveBeenCalledTimes(3);
  });
  it("없는 객체는 오류로 숨기지 않고 명시적인 null을 반환한다", async () => {
    expect(await readPrivateObject({ get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket, "private/missing")).toBeNull();
  });
});
