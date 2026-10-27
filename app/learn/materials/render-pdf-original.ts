import type { RenderTask } from "pdfjs-dist";
import type { TextItem } from "pdfjs-dist/types/src/display/api";
import type { PdfDocumentHandle } from "./pdf-document";

/** 원본 미리보기와 대조 화면이 동일한 페이지 렌더링·취소·권한 확인을 사용합니다. */
export async function renderPdfOriginal(handle: PdfDocumentHandle, filePage: number, canvas: HTMLCanvasElement, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  await handle.assertCurrent(signal);
  signal.throwIfAborted();
  const source = await handle.document.getPage(filePage);
  let rendering: RenderTask | null = null;
  const cancel = (): void => { rendering?.cancel(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const original = source.getViewport({ scale: 1 });
    const scale: number = Math.min(1.5, 1600 / Math.max(original.width, original.height), Math.sqrt(4000000 / (original.width * original.height)));
    const viewport = source.getViewport({ scale });
    canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    rendering = source.render({ canvas, viewport, annotationMode: 0 }); await rendering.promise;
    const content = await source.getTextContent(); signal.throwIfAborted(); await handle.assertCurrent(signal); signal.throwIfAborted();
    return content.items.filter((item): item is TextItem => "str" in item).map((item): string => item.str + (item.hasEOL ? "\n" : " ")).join("");
  } finally { signal.removeEventListener("abort", cancel); rendering?.cancel(); source.cleanup(); }
}
