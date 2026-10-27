import type { ExtractedSegment, Rectangle } from "@/lib/extraction/result";
import type { StoredExtractionPage, ImageMetadata } from "@/lib/extraction/state";

export type SegmentLocation = Readonly<{ kind: "located"; bounds: Rectangle }> | Readonly<{ kind: "unavailable"; reason: string }>;
export type OriginalHighlight = Readonly<{ bounds: Rectangle; label: string; uncertain: boolean }>;

/** 회전·영역 판독의 이미지 좌표를 저장된 역행렬로 원본 표시 좌표에 연결합니다. */
function imageToOriginal(bounds: Rectangle, image: ImageMetadata): SegmentLocation {
  const [a, b, c, d, e, f] = image.sourceToImage;
  const determinant: number = a * d - b * c;
  if (!Number.isFinite(determinant) || determinant === 0) return { kind: "unavailable", reason: "저장된 좌표 변환을 확인할 수 없어 위치를 표시하지 않아요." };
  const corners: readonly (readonly [number, number])[] = [[bounds.x, bounds.y], [bounds.x + bounds.width, bounds.y], [bounds.x, bounds.y + bounds.height], [bounds.x + bounds.width, bounds.y + bounds.height]];
  const projected: readonly (readonly [number, number])[] = corners.map(([x, y]): readonly [number, number] => {
    const px: number = x * image.width - e; const py: number = y * image.height - f;
    return [(d * px - c * py) / determinant / image.sourceWidth, (-b * px + a * py) / determinant / image.sourceHeight];
  });
  if (projected.some((point): boolean => point.some((value): boolean => !Number.isFinite(value) || value < -0.000001 || value > 1.000001))) return { kind: "unavailable", reason: "구간 좌표가 원본 범위를 벗어나 위치를 표시하지 않아요." };
  // 행렬 연산의 부동소수점 오차만 경계 안으로 제한합니다.
  const left: number = Math.max(0, Math.min(...projected.map((point): number => point[0])));
  const top: number = Math.max(0, Math.min(...projected.map((point): number => point[1])));
  const right: number = Math.min(1, Math.max(...projected.map((point): number => point[0])));
  const bottom: number = Math.min(1, Math.max(...projected.map((point): number => point[1])));
  return { kind: "located", bounds: { x: left, y: top, width: right - left, height: bottom - top } };
}

export function originalSegmentLocation(page: StoredExtractionPage, segment: ExtractedSegment): SegmentLocation {
  const bounds: Rectangle | null = segment.bounds;
  if (bounds === null || bounds.width <= 0 || bounds.height <= 0) return { kind: "unavailable", reason: "이 구간에는 위치 좌표가 없어요. 원본 페이지와 문장을 직접 대조해 주세요." };
  if (page.resultImage !== null) return imageToOriginal(bounds, page.resultImage);
  if (page.result?.method === "vision") return { kind: "unavailable", reason: "판독 이미지의 원본 좌표 정보가 없어 위치를 추정하지 않아요." };
  if (bounds.x < 0 || bounds.y < 0 || bounds.x + bounds.width > 1.000001 || bounds.y + bounds.height > 1.000001) return { kind: "unavailable", reason: "구간 좌표가 원본 범위를 벗어나 위치를 표시하지 않아요." };
  return { kind: "located", bounds };
}
