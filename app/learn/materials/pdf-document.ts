import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFWorker } from "pdfjs-dist";
import { requireMaterialResponse } from "./client-api";
import { originalFailure } from "./original-failure";

export const PDFJS_VERSION = "6.4.299";
export const PDFJS_ASSETS = `/pdfjs-${PDFJS_VERSION}/`;
export type PdfDocumentHandle = Readonly<{ document: PDFDocumentProxy; etag: string; assertCurrent: (signal: AbortSignal) => Promise<void>; close: () => Promise<void> }>;
export type PdfDocumentInput = Readonly<{ url: string; pages: number; signal: AbortSignal }>;

/** 인증된 원본의 강한 버전 식별자를 매 단계 확인합니다. */
async function inspectPdf(url: string, signal: AbortSignal): Promise<string> {
  const response: Response = await fetch(url, { method: "HEAD", cache: "no-store", credentials: "same-origin", signal });
  await requireMaterialResponse(response);
  const etag: string | null = response.headers.get("etag");
  if (response.headers.get("content-type") !== "application/pdf" || etag === null || !etag.startsWith('"') || !etag.endsWith('"')) throw originalFailure("PDF 원본 형식 또는 버전을 확인할 수 없어요. 자료 목록을 새로 확인해 주세요.");
  return etag;
}

/** 작업 모듈이 로드된 뒤에만 PDF.js 요청을 보내 누락된 Worker의 종료 대기를 피합니다. */
async function startPdfWorker(signal: AbortSignal): Promise<Worker> {
  const worker: Worker = new Worker(`${PDFJS_ASSETS}worker-entry.mjs`, { type: "module", name: "alter-selected-pdf" });
  try {
    await new Promise<void>((resolve, reject): void => {
      const cleanup = (): void => { clearTimeout(timer); signal.removeEventListener("abort", abort); worker.removeEventListener("message", ready); worker.removeEventListener("error", failure); };
      const abort = (): void => { cleanup(); reject(signal.reason); };
      const failure = (): void => { cleanup(); reject(originalFailure("PDF 작업 파일을 불러오지 못했어요. 네트워크와 Web Worker 지원을 확인해 주세요.")); };
      const ready = (event: MessageEvent<unknown>): void => { const value: unknown = event.data; if (typeof value === "object" && value !== null && "type" in value && value.type === "alter-pdf-ready") { cleanup(); if (!("version" in value) || value.version !== PDFJS_VERSION) reject(originalFailure("PDF 작업 파일 버전이 달라요. 새로고침해 주세요.")); else resolve(); } };
      const timer: ReturnType<typeof setTimeout> = setTimeout(failure, 20000);
      worker.addEventListener("message", ready); worker.addEventListener("error", failure); signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    return worker;
  } catch (error: unknown) { worker.terminate(); throw error; }
}

/** 명시적 네이티브 Worker만 사용하며 가짜 Worker나 서버 렌더링으로 전환하지 않습니다. */
export async function openPdfDocument(input: PdfDocumentInput): Promise<PdfDocumentHandle> {
  if (!/^\/api\/materials\/[0-9a-f-]{36}\/file$/.test(input.url) || !Number.isInteger(input.pages) || input.pages < 1 || input.pages > 500) throw new RangeError("등록된 PDF 주소와 페이지 수가 필요해요.");
  input.signal.throwIfAborted();
  const etag: string = await inspectPdf(input.url, input.signal);
  const pdf = await import("pdfjs-dist");
  input.signal.throwIfAborted();
  if (pdf.version !== PDFJS_VERSION) throw originalFailure("PDF.js와 작업 파일의 버전이 달라요. 페이지를 새로고침해 주세요.");
  const worker: Worker = await startPdfWorker(input.signal);
  const connector: PDFWorker = pdf.PDFWorker.create({ port: worker });
  // 원본 1,600만 화소의 RGBA 디코딩에는 화소당 4바이트가 필요하며 판독 출력 상한과 구분합니다.
  const loading: PDFDocumentLoadingTask = pdf.getDocument({ url: input.url, worker: connector, httpHeaders: { "If-Match": etag }, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true, disableRange: false, stopAtErrors: true, enableXfa: false, maxImageSize: 16000000, canvasMaxAreaInBytes: 64000000, cMapUrl: `${PDFJS_ASSETS}cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`, wasmUrl: `${PDFJS_ASSETS}wasm/`, iccUrl: `${PDFJS_ASSETS}iccs/` });
  let closed: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const close = (): Promise<void> => {
    if (closed !== null) return closed;
    input.signal.removeEventListener("abort", abort);
    if (timer !== null) clearTimeout(timer);
    closed = (async (): Promise<void> => {
      let cleanupTimer: ReturnType<typeof setTimeout> | null = null;
      try { await Promise.race([loading.destroy(), new Promise<never>((_resolve, reject): void => { cleanupTimer = setTimeout((): void => { reject(originalFailure("PDF 정리 응답이 없어 Worker를 종료했어요.")); }, 2000); })]); }
      finally { if (cleanupTimer !== null) clearTimeout(cleanupTimer); connector.destroy(); worker.terminate(); }
    })();
    return closed;
  };
  const abort = (): void => { void close().catch((error: unknown): void => { console.warn({ event: "pdf_cleanup_failed", errorType: error instanceof Error ? error.name : "unknown" }); }); };
  input.signal.addEventListener("abort", abort, { once: true });
  const failed: Promise<never> = new Promise((_resolve, reject): void => {
    worker.addEventListener("error", (): void => { reject(originalFailure("PDF 작업 파일을 불러오지 못했어요. 네트워크와 Web Worker 지원을 확인해 주세요.")); }, { once: true });
    timer = setTimeout((): void => { reject(originalFailure("PDF 준비 시간이 초과됐어요. 원본과 네트워크 상태를 확인해 주세요.")); }, 20000);
  });
  try {
    const document: PDFDocumentProxy = await Promise.race([loading.promise, failed]);
    if (timer !== null) clearTimeout(timer);
    input.signal.throwIfAborted();
    if (document.numPages !== input.pages) throw originalFailure("저장된 페이지 수와 PDF 내용이 달라요. 원본 상태를 확인해 주세요.");
    const assertCurrent = async (signal: AbortSignal): Promise<void> => { signal.throwIfAborted(); if (closed !== null) throw originalFailure("PDF 작업이 종료됐어요. 원본을 다시 열어 주세요."); if (await inspectPdf(input.url, signal) !== etag) throw originalFailure("원본 버전이 변경됐어요. 자료 목록에서 다시 선택해 주세요."); };
    return { document, etag, assertCurrent, close };
  } catch (error: unknown) {
    try { await close(); } catch (cleanupError: unknown) { throw new AggregateError([error, cleanupError], error instanceof Error ? error.message : "PDF 작업을 종료하지 못했어요."); }
    if (error instanceof Error && error.name === "PasswordException") throw originalFailure("암호화된 PDF는 추출할 수 없어요. 암호가 해제된 원본을 등록해 주세요.");
    if (error instanceof Error && error.name === "InvalidPDFException") throw originalFailure("PDF가 손상되어 읽을 수 없어요. 원본 파일을 확인해 주세요.");
    throw error;
  }
}
