import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { openPdfDocument } from "../../app/learn/materials/pdf-document";

const fixture = vi.hoisted(() => ({ version: "6.4.299", destroy: vi.fn(), connectorDestroy: vi.fn(), terminate: vi.fn(), load: vi.fn(), create: vi.fn() }));
vi.mock("pdfjs-dist", () => ({ get OPS(): typeof OPS { return OPS; }, get version(): string { return fixture.version; }, PDFWorker: { create: fixture.create }, getDocument: fixture.load }));
const url: string = "/api/materials/00000000-0000-4000-8000-000000000001/file";

beforeEach((): void => {
  fixture.version = "6.4.299";
  fixture.destroy.mockReset().mockResolvedValue(undefined);
  fixture.connectorDestroy.mockReset(); fixture.terminate.mockReset();
  fixture.create.mockReset().mockReturnValue({ destroy: fixture.connectorDestroy });
  fixture.load.mockReset().mockReturnValue({ promise: Promise.resolve({ numPages: 3 }), destroy: fixture.destroy });
  vi.stubGlobal("Worker", class extends EventTarget { constructor() { super(); queueMicrotask((): void => { this.dispatchEvent(new MessageEvent("message", { data: { type: "alter-pdf-ready", version: "6.4.299" } })); }); } terminate = fixture.terminate; });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { headers: { "Content-Type": "application/pdf", etag: '"original-v1"' } })));
});
afterEach((): void => { vi.unstubAllGlobals(); });

describe("인증된 PDF Worker 수명과 원본 고정", (): void => {
  it("동일 버전만 읽고 여러 번 닫아도 한 번 해제한다", async (): Promise<void> => {
    const signal: AbortSignal = new AbortController().signal;
    const handle = await openPdfDocument({ url, pages: 3, signal });
    expect(handle.imageOperators).toBe(OPS);
    await handle.assertCurrent(signal);
    expect(fixture.load).toHaveBeenCalledWith(expect.objectContaining({ httpHeaders: { "If-Match": '"original-v1"' }, disableAutoFetch: true, disableStream: true }));
    await Promise.all([handle.close(), handle.close()]);
    expect(fixture.destroy).toHaveBeenCalledTimes(1); expect(fixture.terminate).toHaveBeenCalledTimes(1); expect(fixture.connectorDestroy).toHaveBeenCalledTimes(1);
    await expect(handle.assertCurrent(signal)).rejects.toThrow("종료");
  });
  it("변경된 원본을 처리하지 않는다", async (): Promise<void> => {
    const signal: AbortSignal = new AbortController().signal;
    const handle = await openPdfDocument({ url, pages: 3, signal });
    vi.mocked(fetch).mockResolvedValue(new Response(null, { headers: { "Content-Type": "application/pdf", etag: '"v2"' } }));
    await expect(handle.assertCurrent(signal)).rejects.toThrow("원본 버전"); await handle.close();
  });
  it("API 버전이 다르면 Worker를 만들지 않는다", async (): Promise<void> => {
    fixture.version = "0.0.0";
    await expect(openPdfDocument({ url, pages: 3, signal: new AbortController().signal })).rejects.toThrow("버전"); expect(fixture.create).not.toHaveBeenCalled();
  });
  it("페이지 수가 다르면 리소스를 해제한다", async (): Promise<void> => {
    await expect(openPdfDocument({ url, pages: 2, signal: new AbortController().signal })).rejects.toThrow("페이지 수"); expect(fixture.destroy).toHaveBeenCalledOnce();
  });
  for (const failure of [{ name: "PasswordException", message: "암호화" }, { name: "InvalidPDFException", message: "손상" }]) {
    it(`${failure.name}을 명시적으로 안내한다`, async (): Promise<void> => {
      const error: Error = Object.assign(new Error("fixture"), { name: failure.name });
      fixture.load.mockReturnValue({ promise: Promise.reject(error), destroy: fixture.destroy });
      await expect(openPdfDocument({ url, pages: 3, signal: new AbortController().signal })).rejects.toThrow(failure.message); expect(fixture.terminate).toHaveBeenCalledOnce();
    });
  }
  it("외부 주소와 인증 오류에서는 PDF를 열지 않는다", async (): Promise<void> => {
    await expect(openPdfDocument({ url: "https://other.invalid/file", pages: 3, signal: new AbortController().signal })).rejects.toThrow("등록된 PDF");
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status: 401 }));
    await expect(openPdfDocument({ url, pages: 3, signal: new AbortController().signal })).rejects.toThrow("로그인이 만료"); expect(fixture.load).not.toHaveBeenCalled();
  });
});
