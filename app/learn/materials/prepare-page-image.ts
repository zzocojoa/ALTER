import type { PDFPageProxy, RenderTask } from "pdfjs-dist";
import { boundedImageGeometry, boundedPdfGeometry, boundedPdfRegionGeometry, preparedPageImage } from "@/lib/extraction/image";
import type { ImageGeometry, PageRotation, PreparedPageImage, PdfRegion } from "@/lib/extraction/image";
import { extractionLimits, requireSelectedPage } from "@/lib/extraction/selection";
import type { SelectionBinding } from "@/lib/extraction/selection";
import type { MaterialFileReference } from "@/lib/materials/attachment";
import type { PdfDocumentHandle } from "./pdf-document";
import { requireMaterialResponse } from "./client-api";

async function encodePage(canvas: HTMLCanvasElement, geometry: ImageGeometry, sourceWidth: number, sourceHeight: number, rotation: PageRotation, coordinateSpace: PreparedPageImage["coordinateSpace"], region: PdfRegion | null, signal: AbortSignal): Promise<PreparedPageImage> {
  signal.throwIfAborted();
  const blob: Blob = await new Promise<Blob>((resolve, reject): void => { canvas.toBlob((result: Blob | null): void => { if (result === null) reject(new Error("판독용 이미지 인코딩에 실패했어요. 브라우저 메모리를 확인해 주세요.")); else resolve(result); }, "image/png"); });
  signal.throwIfAborted();
  if (blob.type !== "image/png" || blob.size < 1 || blob.size > extractionLimits.imageBytes) throw new RangeError("판독용 이미지가 2MiB를 넘거나 지원하지 않는 형식이에요. 원본을 작은 구간으로 나누어 등록해 주세요.");
  const bytes: Uint8Array<ArrayBuffer> = new Uint8Array(await blob.arrayBuffer());
  const hash: string = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value: number): string => value.toString(16).padStart(2, "0")).join("");
  const base64: string = await new Promise<string>((resolve, reject): void => { const reader: FileReader = new FileReader(); reader.onload = (): void => { if (typeof reader.result !== "string") reject(new Error("이미지 변환 결과가 올바르지 않아요.")); else resolve(reader.result); }; reader.onerror = (): void => { reject(reader.error ?? new Error("이미지를 읽지 못했어요.")); }; reader.readAsDataURL(blob); });
  signal.throwIfAborted();
  return preparedPageImage.parse({ dataUrl: base64, mime: "image/png", bytes: bytes.length, sha256: hash, ...geometry, sourceWidth, sourceHeight, rotation, coordinateSpace, ...(region === null ? {} : { region }) });
}

/** 선택한 PDF 한 페이지만 캔버스에 그리며 어떤 경로로 종료하든 픽셀과 페이지를 해제합니다. */
export async function preparePdfPageImage(handle: PdfDocumentHandle, binding: SelectionBinding, filePage: number, rotation: PageRotation, signal: AbortSignal): Promise<PreparedPageImage> {
  return renderPreparedPdfPage(handle, binding, filePage, rotation, (width, height) => boundedPdfGeometry(width, height, rotation), "pdf-raster", null, signal);
}

export async function preparePdfRegionImage(handle: PdfDocumentHandle, binding: SelectionBinding, filePage: number, region: PdfRegion, rotation: PageRotation, signal: AbortSignal): Promise<PreparedPageImage> {
  return renderPreparedPdfPage(handle, binding, filePage, rotation, (width, height) => boundedPdfRegionGeometry(width, height, region, rotation), "pdf-region", region, signal);
}

async function renderPreparedPdfPage(handle: PdfDocumentHandle, binding: SelectionBinding, filePage: number, rotation: PageRotation, geometryFromSource: (width: number, height: number) => ImageGeometry, coordinateSpace: PreparedPageImage["coordinateSpace"], region: PdfRegion | null, signal: AbortSignal): Promise<PreparedPageImage> {
  requireSelectedPage(binding, binding.jobId, binding.revision, filePage); await handle.assertCurrent(signal);
  const page: PDFPageProxy = await handle.document.getPage(filePage);
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  let rendering: RenderTask | null = null;
  const cancel = (): void => { rendering?.cancel(); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    signal.throwIfAborted();
    const source = page.getViewport({ scale: 1 });
    const geometry: ImageGeometry = geometryFromSource(source.width, source.height);
    canvas.width = geometry.width; canvas.height = geometry.height;
    rendering = page.render({ canvas, viewport: source, transform: [...geometry.sourceToImage], annotationMode: 0, background: "rgb(255,255,255)" });
    await rendering.promise; signal.throwIfAborted(); await handle.assertCurrent(signal);
    return await encodePage(canvas, geometry, source.width, source.height, rotation, coordinateSpace, region, signal);
  } finally { signal.removeEventListener("abort", cancel); rendering?.cancel(); canvas.width = 0; canvas.height = 0; page.cleanup(); }
}

/** 인증된 등록 사진만 읽고 방향이 적용된 원본 표시 좌표에 회전 행렬을 연결합니다. */
export async function preparePhotoImage(file: MaterialFileReference, binding: SelectionBinding, rotation: PageRotation, signal: AbortSignal): Promise<PreparedPageImage> {
  requireSelectedPage(binding, binding.jobId, binding.revision, 1);
  if (file.kind !== "image" || file.materialId !== binding.selection.materialId || file.objectVersion !== binding.selection.originalVersion || file.sha256 !== binding.selection.originalHash) throw new Error("선택한 등록 사진의 원본 버전이 필요해요.");
  const response: Response = await fetch(file.sourceUrl, { credentials: "same-origin", cache: "no-store", signal }); await requireMaterialResponse(response);
  const blob: Blob = await response.blob();
  if (blob.size !== file.bytes || !["image/png", "image/jpeg"].includes(blob.type)) throw new Error("원본 사진의 형식이나 크기가 달라요.");
  const originalHash: string = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())), (value: number): string => value.toString(16).padStart(2, "0")).join("");
  if (originalHash !== file.sha256) throw new Error("원본 사진 내용이 달라요. 자료를 다시 확인해 주세요.");
  const bitmap: ImageBitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const canvas: HTMLCanvasElement = document.createElement("canvas");
  try {
    signal.throwIfAborted();
    if (bitmap.width * bitmap.height > 16000000) throw new RangeError("원본 사진의 픽셀 한도를 넘었어요.");
    const geometry: ImageGeometry = boundedImageGeometry(bitmap.width, bitmap.height, rotation);
    canvas.width = geometry.width; canvas.height = geometry.height;
    const context: CanvasRenderingContext2D | null = canvas.getContext("2d");
    if (context === null) throw new Error("이미지 캔버스를 만들 수 없어요. 브라우저 메모리를 확인해 주세요.");
    context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height); context.setTransform(...geometry.sourceToImage); context.drawImage(bitmap, 0, 0);
    return await encodePage(canvas, geometry, bitmap.width, bitmap.height, rotation, "decoded-image", null, signal);
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0; }
}
