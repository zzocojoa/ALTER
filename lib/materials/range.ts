export type MaterialRange = Readonly<{ offset: number; length: number }>;
export type MaterialRangeResult = Readonly<{ kind: "full" }> | Readonly<{ kind: "range"; range: MaterialRange }> | Readonly<{ kind: "unsatisfiable" }>;

/** 하나의 바이트 범위만 지원하며 잘못된 수치나 다중 범위는 명시적으로 거부합니다. */
export function parseMaterialRange(value: string | null, bytes: number): MaterialRangeResult {
  if (!Number.isSafeInteger(bytes) || bytes < 1) throw new RangeError("확정된 원본 크기는 양의 안전한 정수여야 합니다.");
  if (value === null) return { kind: "full" };
  const match: RegExpExecArray | null = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (match === null || match[1] === "" && match[2] === "") return { kind: "unsatisfiable" };
  const start: number = Number(match[1]);
  const end: number = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) return { kind: "unsatisfiable" };
  if (match[1] === "") return end < 1 ? { kind: "unsatisfiable" } : { kind: "range", range: { offset: Math.max(0, bytes - end), length: Math.min(bytes, end) } };
  if (start >= bytes || match[2] !== "" && end < start) return { kind: "unsatisfiable" };
  const last: number = match[2] === "" ? bytes - 1 : Math.min(bytes - 1, end);
  return { kind: "range", range: { offset: start, length: last - start + 1 } };
}
