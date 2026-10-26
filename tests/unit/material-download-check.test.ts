import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyMaterialDownload } from "../../app/learn/materials/download-check";
import type { MaterialFileReference } from "../../lib/materials/attachment";

const original: Uint8Array = Uint8Array.from({ length: 131_073 }, (_value: unknown, index: number): number => index % 251);
const file: MaterialFileReference = { materialId: "00000000-0000-4000-a000-000000000186", kind: "pdf", role: "reference", pages: 1, bytes: original.byteLength, sha256: createHash("sha256").update(original).digest("hex"), objectVersion: "v1", sourceUrl: "/api/materials/00000000-0000-4000-a000-000000000186/file" };
function response(bytes: Uint8Array, status: number, etag: string, range: string | null, cancel: () => void): Response {
  let offset: number = 0;
  const body: ReadableStream<Uint8Array> = new ReadableStream({ type: "bytes", pull(controller: ReadableByteStreamController): void {
    const end: number = Math.min(bytes.byteLength, offset + 65_536);
    controller.enqueue(bytes.slice(offset, end)); offset = end;
    if (offset === bytes.byteLength) controller.close();
  }, cancel });
  const headers: Headers = new Headers({ etag });
  if (range !== null) headers.set("content-range", range);
  return new Response(body, { status, headers });
}
function noCancel(): void {}
function validResponses(): readonly Response[] {
  return [response(original, 200, '"v1"', null, noCancel), response(original.slice(65_536), 206, '"v1"', "bytes 65536-131072/131073", noCancel), response(original, 200, '"v1"', null, noCancel)];
}
function mockResponses(responses: readonly Response[]): ReturnType<typeof vi.fn<typeof fetch>> {
  const mocked = vi.fn<typeof fetch>();
  responses.forEach((item: Response): void => { mocked.mockResolvedValueOnce(item); });
  vi.stubGlobal("fetch", mocked);
  return mocked;
}
afterEach((): void => { vi.unstubAllGlobals(); });

describe("읽기 전용 원본 중단·재개 검사", (): void => {
  it("일부 수신을 실제 취소하고 같은 버전의 이어받기와 전체 재조회 해시를 확인한다", async (): Promise<void> => {
    const cancel = vi.fn<() => void>();
    const responses: readonly Response[] = validResponses();
    const fetcher = mockResponses([response(original, 200, '"v1"', null, cancel), ...responses.slice(1)]);
    const proof = await verifyMaterialDownload(file);
    expect(cancel).toHaveBeenCalledOnce();
    expect(proof).toMatchObject({ bytesBeforeCancellation: 65_536, resumedBytes: 65_537, originalBytes: 131_073, sha256: file.sha256, maximumReadBufferBytes: 65_536 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][1]?.headers).toEqual({ range: "bytes=65536-", "if-range": '"v1"' });
    expect(fetcher.mock.calls.every((call): boolean => call[1]?.method === "GET" && call[1]?.credentials === "same-origin")).toBe(true);
  });
  it("이어받기가 전체 200 응답이면 통과시키지 않고 본문을 취소한다", async (): Promise<void> => {
    const cancel = vi.fn<() => void>();
    const fetcher = mockResponses([validResponses()[0], response(original, 200, '"v1"', null, cancel)]);
    await expect(verifyMaterialDownload(file)).rejects.toThrow("resume-status:200");
    expect(cancel).toHaveBeenCalledOnce(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("이어받기 ETag가 변경되면 이전 파일 조각과 합치지 않는다", async (): Promise<void> => {
    mockResponses([validResponses()[0], response(original.slice(65_536), 206, '"v2"', "bytes 65536-131072/131073", noCancel)]);
    await expect(verifyMaterialDownload(file)).rejects.toThrow("resume-etag-changed");
  });
  it("Range 위치 불일치를 거부한다", async (): Promise<void> => {
    mockResponses([validResponses()[0], response(original.slice(65_536), 206, '"v1"', "bytes 65535-131072/131073", noCancel)]);
    await expect(verifyMaterialDownload(file)).rejects.toThrow("resume-content-range");
  });
  it("이어받기가 잘리면 길이 불일치를 보고한다", async (): Promise<void> => {
    mockResponses([validResponses()[0], response(original.slice(65_536, -1), 206, '"v1"', "bytes 65536-131072/131073", noCancel)]);
    await expect(verifyMaterialDownload(file)).rejects.toThrow("received-bytes:131072/expected:131073");
  });
  it("길이가 같아도 원본 바이트가 바뀌면 해시 불일치를 보고한다", async (): Promise<void> => {
    const corrupt: Uint8Array = original.slice(65_536); corrupt[0] ^= 1;
    mockResponses([validResponses()[0], response(corrupt, 206, '"v1"', "bytes 65536-131072/131073", noCancel)]);
    await expect(verifyMaterialDownload(file)).rejects.toThrow("sha256-mismatch");
  });
  it("로그인 만료 시 원본 본문이나 재시도를 요청하지 않는다", async (): Promise<void> => {
    const fetcher = mockResponses([new Response(null, { status: 401 })]);
    await expect(verifyMaterialDownload(file)).rejects.toThrow("로그인이 만료");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
