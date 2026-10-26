import { z } from "zod";
import { extractionLimits } from "./selection.ts";
import { transform } from "./result.ts";
import type { Transform } from "./result.ts";

export const pageRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type PageRotation = z.infer<typeof pageRotation>;
export const pdfRegion = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().refine((region): boolean => region.x + region.width <= 1 && region.y + region.height <= 1, "판독 영역은 원본 페이지 안에 있어야 해요.");
export type PdfRegion = Readonly<z.infer<typeof pdfRegion>>;
export const preparedPageImage = z.object({ dataUrl: z.string().max(2800000).regex(/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/), mime: z.enum(["image/png", "image/jpeg"]), bytes: z.number().int().positive().max(extractionLimits.imageBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive().max(extractionLimits.imageLongSide), height: z.number().int().positive().max(extractionLimits.imageLongSide), sourceWidth: z.number().finite().positive().max(1000000), sourceHeight: z.number().finite().positive().max(1000000), rotation: pageRotation, sourceToImage: transform, coordinateSpace: z.enum(["pdf-viewport", "pdf-raster", "pdf-region", "decoded-image"]), region: pdfRegion.optional() }).strict();
export type PreparedPageImage = Readonly<z.infer<typeof preparedPageImage>>;
export type ImageGeometry = Readonly<{ width: number; height: number; sourceToImage: Transform }>;

/** 표시 방향 기준 좌표를 유지하며 확대하지 않고 두 상한을 동시에 지킵니다. */
export function boundedImageGeometry(width: number, height: number, rotation: PageRotation): ImageGeometry {
  return boundedRasterGeometry(width, height, rotation, 1);
}

/** PDF의 포인트 좌표를 최대 216dpi로 렌더링하며 픽셀 상한을 함께 지킵니다. */
export function boundedPdfGeometry(width: number, height: number, rotation: PageRotation): ImageGeometry {
  return boundedRasterGeometry(width, height, rotation, 3);
}

/** 작은 글씨를 원본 영역에서 직접 렌더링하고 전체 페이지와의 좌표 관계를 보존합니다. */
export function boundedPdfRegionGeometry(width: number, height: number, region: PdfRegion, rotation: PageRotation): ImageGeometry {
  pdfRegion.parse(region);
  if (![width, height].every((value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1000000)) throw new RangeError("PDF 원본 크기를 확인해 주세요.");
  const geometry: ImageGeometry = boundedRasterGeometry(width * region.width, height * region.height, rotation, 6);
  const [a,b,c,d,e,f] = geometry.sourceToImage;
  return { ...geometry, sourceToImage: [a,b,c,d,e-a*width*region.x-c*height*region.y,f-b*width*region.x-d*height*region.y] };
}

function boundedRasterGeometry(width: number, height: number, rotation: PageRotation, maximumScale: number): ImageGeometry {
  if (![width, height].every((value: number): boolean => Number.isFinite(value) && value > 0 && value <= 1000000)) throw new RangeError("이미지 원본 크기를 확인할 수 없어요.");
  pageRotation.parse(rotation);
  const rotatedWidth: number = rotation === 90 || rotation === 270 ? height : width;
  const rotatedHeight: number = rotation === 90 || rotation === 270 ? width : height;
  const scale: number = Math.min(maximumScale, extractionLimits.imageLongSide / Math.max(rotatedWidth, rotatedHeight), Math.sqrt(extractionLimits.imagePixels / (width * height)));
  const outputWidth: number = Math.floor(rotatedWidth * scale); const outputHeight: number = Math.floor(rotatedHeight * scale);
  if (outputWidth < 1 || outputHeight < 1) throw new RangeError("페이지 비율이 너무 커 판독용 이미지를 만들 수 없어요.");
  const sx: number = outputWidth / rotatedWidth; const sy: number = outputHeight / rotatedHeight;
  const matrix: Transform = rotation === 0 ? [sx, 0, 0, sy, 0, 0] : rotation === 90 ? [0, sy, -sx, 0, outputWidth, 0] : rotation === 180 ? [-sx, 0, 0, -sy, outputWidth, outputHeight] : [0, -sy, sx, 0, 0, outputHeight];
  return { width: outputWidth, height: outputHeight, sourceToImage: matrix };
}

export function requireImageGeometry(image: PreparedPageImage): void {
  preparedPageImage.parse(image);
  if ((image.coordinateSpace === "pdf-region") !== (image.region !== undefined)) throw new RangeError("PDF 판독 영역과 좌표 방식이 일치하지 않아요.");
  const expected: ImageGeometry = image.region ? boundedPdfRegionGeometry(image.sourceWidth, image.sourceHeight, image.region, image.rotation) : image.coordinateSpace === "pdf-raster" ? boundedPdfGeometry(image.sourceWidth, image.sourceHeight, image.rotation) : boundedImageGeometry(image.sourceWidth, image.sourceHeight, image.rotation);
  if (image.width !== expected.width || image.height !== expected.height || image.width * image.height > extractionLimits.imagePixels || image.sourceToImage.some((value: number, index: number): boolean => Math.abs(value - expected.sourceToImage[index]) > 0.000001)) throw new RangeError("이미지 크기나 원본 좌표 변환이 일치하지 않아요.");
  if (!image.dataUrl.startsWith(`data:${image.mime};base64,`)) throw new Error("이미지 형식 표시가 일치하지 않아요.");
}
