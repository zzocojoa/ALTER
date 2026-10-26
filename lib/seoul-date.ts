export type SeoulDate = Readonly<{ isoDate: string; label: string }>;

function datePart(parts: readonly Intl.DateTimeFormatPart[], name: "year" | "month" | "day"): string {
  const value: string | undefined = parts.find((part) => part.type === name)?.value;
  if (!value) throw new RangeError(`서울 날짜 구성 요소가 없습니다: ${name}`);
  return value;
}

/** 입력 날짜를 변경하지 않고 서버·브라우저의 기본 시간대와 무관한 서울 날짜를 만듭니다. */
export function formatSeoulDate(instant: Date): SeoulDate {
  if (!Number.isFinite(instant.getTime())) throw new RangeError("유효하지 않은 날짜입니다. 올바른 시각을 전달하세요.");
  const options: Intl.DateTimeFormatOptions = { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" };
  const parts: readonly Intl.DateTimeFormatPart[] = new Intl.DateTimeFormat("en", options).formatToParts(instant);
  return {
    isoDate: [datePart(parts, "year"), datePart(parts, "month"), datePart(parts, "day")].join("-"),
    label: new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", weekday: "long" }).format(instant),
  };
}
