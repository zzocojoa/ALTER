import { z } from "zod";
import { extractionLimits } from "./selection.ts";

const coordinate = z.number().finite().min(-1000000).max(1000000);
export const transform = z.tuple([coordinate, coordinate, coordinate, coordinate, coordinate, coordinate]);
export const rectangle = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), width: z.number().min(0).max(1), height: z.number().min(0).max(1) }).strict();
export const extractedSegment = z.object({ id: z.string().regex(/^s[0-9]{1,4}$/), kind: z.enum(["text", "formula", "table", "unreadable"]), text: z.string().max(extractionLimits.charactersPerPage), bounds: rectangle.nullable(), transform: transform.nullable(), uncertain: z.boolean(), reason: z.string().max(500).nullable() }).strict();
export const pageResult = z.object({ filePage: z.number().int().min(1).max(500), method: z.enum(["text-layer", "vision", "plain-text", "manual-correction"]), status: z.enum(["complete", "blank", "no-text", "unreadable", "failed"]), width: z.number().finite().positive().max(1000000).nullable(), height: z.number().finite().positive().max(1000000).nullable(), rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]), segments: z.array(extractedSegment).max(extractionLimits.segmentsPerPage), error: z.string().min(1).max(1000).nullable(), requiresConfirmation: z.literal(true) }).strict();
export type Rectangle = Readonly<z.infer<typeof rectangle>>;
export type Transform = Readonly<z.infer<typeof transform>>;
export type ExtractedSegment = Readonly<z.infer<typeof extractedSegment>>;
export type PageResult = Readonly<z.infer<typeof pageResult>>;

/** 구조 검사 외에 전체 길이·구간 범위·실패 상태의 의미도 검사합니다. */
export function validatePageResult(value: unknown, filePage: number): PageResult {
  const result: PageResult = pageResult.parse(value);
  if (result.filePage !== filePage || new Set(result.segments.map((segment): string => segment.id)).size !== result.segments.length) throw new Error("추출 결과의 파일 페이지 또는 구간 식별자가 달라요.");
  if (result.segments.reduce((total: number, segment: ExtractedSegment): number => total + segment.text.length, 0) > extractionLimits.charactersPerPage) throw new RangeError("페이지 텍스트가 60,000자를 넘었어요. 작은 구간의 원본으로 나누어 등록해 주세요.");
  if ((result.width === null) !== (result.height === null) || (["text-layer", "vision"].includes(result.method) && result.status !== "failed" && result.width === null)) throw new Error("페이지 좌표계가 필요해요.");
  for (const segment of result.segments) {
    if (segment.bounds !== null && (segment.bounds.x + segment.bounds.width > 1.000001 || segment.bounds.y + segment.bounds.height > 1.000001)) throw new RangeError("구간 좌표가 페이지 범위를 벗어났어요.");
    if (segment.uncertain && !segment.reason || segment.kind === "unreadable" && !segment.uncertain) throw new Error("불확실하거나 읽을 수 없는 구간에는 이유가 필요해요.");
  }
  if ((result.status === "failed") !== (result.error !== null) || ["blank", "no-text", "failed"].includes(result.status) && result.segments.length !== 0 || result.status === "complete" && result.segments.length === 0) throw new Error("페이지 처리 상태와 내용이 일치하지 않아요.");
  return result;
}

export type PositionedText = Readonly<{ str: string; transform: readonly number[]; width: number; height: number; hasEOL: boolean }>;
export type PageGeometry = Readonly<{ width: number; height: number; transform: readonly number[] }>;

/** 문자 위치와 순서를 보존하되 표·수식의 의미와 읽기 순서를 확정하지 않습니다. */
export function positionText(items: readonly PositionedText[], geometry: PageGeometry): readonly ExtractedSegment[] {
  if (!Number.isFinite(geometry.width) || !Number.isFinite(geometry.height) || geometry.width <= 0 || geometry.height <= 0) throw new RangeError("PDF 페이지 크기가 올바르지 않아요.");
  const matrix: Transform = transform.parse(geometry.transform);
  const visible: readonly PositionedText[] = items.filter((item: PositionedText): boolean => item.str.length > 0);
  if (visible.length > extractionLimits.segmentsPerPage) throw new RangeError("페이지 구간이 너무 많아요. 작은 구간의 원본으로 나누어 등록해 주세요.");
  return visible.map((item: PositionedText, index: number): ExtractedSegment => {
    const raw: Transform = transform.parse(item.transform);
    if (![item.width, item.height].every((number: number): boolean => Number.isFinite(number) && number >= 0 && number <= 1000000)) throw new RangeError("PDF 문자 크기가 올바르지 않아요.");
    const angle: number = Math.atan2(raw[1], raw[0]);
    const x: number = raw[4]; const y: number = raw[5];
    const w: readonly [number, number] = [item.width * Math.cos(angle), item.width * Math.sin(angle)];
    const h: readonly [number, number] = [-item.height * Math.sin(angle), item.height * Math.cos(angle)];
    const points: readonly (readonly [number, number])[] = [[x, y], [x + w[0], y + w[1]], [x + h[0], y + h[1]], [x + w[0] + h[0], y + w[1] + h[1]]];
    const projected = points.map(([px, py]): readonly [number, number] => [(matrix[0] * px + matrix[2] * py + matrix[4]) / geometry.width, (matrix[1] * px + matrix[3] * py + matrix[5]) / geometry.height]);
    const left: number = Math.max(0, Math.min(1, Math.min(...projected.map((p): number => p[0]))));
    const top: number = Math.max(0, Math.min(1, Math.min(...projected.map((p): number => p[1]))));
    const right: number = Math.max(left, Math.min(1, Math.max(...projected.map((p): number => p[0]))));
    const bottom: number = Math.max(top, Math.min(1, Math.max(...projected.map((p): number => p[1]))));
    const clipped: boolean = projected.some((p): boolean => p.some((value): boolean => value < 0 || value > 1));
    return { id: `s${index}`, kind: "text", text: item.str + (item.hasEOL ? "\n" : ""), bounds: { x: left, y: top, width: right - left, height: bottom - top }, transform: [...raw], uncertain: true, reason: clipped ? "페이지 밖 문자 위치가 있어 원본 대조가 필요합니다." : "읽기 순서와 표·수식 배치를 원본과 대조해 주세요." };
  });
}
