import { describe, expect, it } from "vitest";
import { formatSeoulDate } from "../../lib/seoul-date";

describe("서울 날짜", () => {
  it.each([
    ["2026-10-23T14:59:59.999Z", "2026-10-23"],
    ["2026-10-23T15:00:00.000Z", "2026-10-24"],
    ["2026-12-31T15:00:00.000Z", "2027-01-01"],
    ["2028-02-28T15:00:00.000Z", "2028-02-29"],
  ])("%s의 서울 날짜는 %s다", (iso, expected) => {
    const instant: Date = new Date(iso);
    const before: number = instant.getTime();
    expect(formatSeoulDate(instant).isoDate).toBe(expected);
    expect(instant.getTime()).toBe(before);
  });
  it("한국어 날짜와 요일을 반환한다", () => {
    expect(formatSeoulDate(new Date("2026-10-23T15:00:00Z")).label).toBe("2026년 10월 24일 토요일");
  });
  it("잘못된 날짜를 현재 날짜로 대체하지 않는다", () => {
    expect(() => formatSeoulDate(new Date("invalid"))).toThrow(RangeError);
  });
});
