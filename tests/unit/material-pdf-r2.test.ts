import { describe, expect, it, vi } from "vitest";
import { pdfR2Source } from "../../lib/materials/pdf-r2";

const saved = { size: 100, etag: "etag-original", version: "version-original" } as const;
function response(): R2ObjectBody { return { ...saved, range: { offset: 20, length: 8 }, body: new ReadableStream(), arrayBuffer: async (): Promise<ArrayBuffer> => new ArrayBuffer(8) } as R2ObjectBody; }
function bucket(get: ReturnType<typeof vi.fn>): R2Bucket { return { get } as unknown as R2Bucket; }
describe("PDF R2 Range 버전 경계", () => {
  it("동일 버전과 정확한 Range만 반환한다", async () => {
    const get = vi.fn().mockResolvedValue(response());
    const bytes: Uint8Array = await pdfR2Source(bucket(get), "owned-key", saved).read(20, 8, new AbortController().signal);
    expect(bytes.length).toBe(8);
    expect(get).toHaveBeenCalledWith("owned-key", { range: { offset: 20, length: 8 }, onlyIf: { etagMatches: saved.etag } });
  });
  it.each([null, saved, { ...response(), version: "changed" }, { ...response(), etag: "changed" }, { ...response(), range: { offset: 21, length: 8 } }])("없거나 변경된 객체는 재시도하지 않는다", async (object) => {
    const get = vi.fn().mockResolvedValue(object);
    await expect(pdfR2Source(bucket(get), "owned-key", saved).read(20, 8, new AbortController().signal)).rejects.toMatchObject({ status: 409 });
    expect(get).toHaveBeenCalledTimes(1);
  });
  it("일시적 서비스 오류만 같은 조건으로 재시도한다", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failure: Error = new Error("fixture service failure");
    const get = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue(response());
    await expect(pdfR2Source(bucket(get), "owned-key", saved).read(20, 8, new AbortController().signal)).resolves.toHaveLength(8);
    expect(get).toHaveBeenCalledTimes(2); expect(warn).toHaveBeenCalledWith(expect.objectContaining({ event: "pdf_range_retry", offset: 20, length: 8, attempt: 1 }));
  });
  it("잘못된 범위와 취소는 R2 호출 전에 거부한다", async () => {
    const get = vi.fn();
    const source = pdfR2Source(bucket(get), "owned-key", saved);
    await expect(source.read(0, 65537, new AbortController().signal)).rejects.toThrow();
    await expect(source.read(99, 2, new AbortController().signal)).rejects.toThrow();
    await expect(source.read(20, 8, AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(get).not.toHaveBeenCalled();
  });
});
