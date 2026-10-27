import { describe, expect, it } from "vitest";
import { learningNavigation, navigationGroup } from "../../lib/ui/navigation";

describe("기존 경로를 유지하는 학습 탐색", () => {
  it("정확히 다섯 개의 기존 의미와 명시적 더보기 진입을 갖는다", (): void => {
    expect(learningNavigation.map((item): string => item.href)).toEqual(["/learn", "/learn/materials", "/learn/tutor", "/learn/results", "/learn/more"]);
  });
  it.each([
    ["/learn/advisor", "study"], ["/learn/library", "study"], ["/learn/editor", "study"], ["/learn/calendar", "study"], ["/learn/weekly/version", "records"], ["/learn/google/references", "more"], ["/learn/backup", "more"], ["/learn/source/00000000-0000-4000-a000-000000000001", "materials"],
  ])("하위 경로 %s의 위치를 분류한다", (path, group): void => { expect(navigationGroup(path)).toBe(group); });
  it.each(["https://example.test/learn", "/learn-other", "/setup", "/learn/source/"])("등록되지 않은 경로를 다른 메뉴로 조용히 대체하지 않는다: %s", (path): void => { expect((): void => { navigationGroup(path); }).toThrow(RangeError); });
});
