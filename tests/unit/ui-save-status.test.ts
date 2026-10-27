import { describe, expect, it } from "vitest";
import { savePresentation } from "../../lib/ui/save-status";

describe("저장 확인의 경계", (): void => {
  it("응답 유실·실패·충돌을 저장 성공으로 표시하지 않는다", (): void => {
    for (const kind of ["error", "unknown", "conflict"] as const) {
      const result = savePresentation({ kind, detail: "현재 입력을 보관하고 같은 요청의 결과를 확인해 주세요." });
      expect(result.persistence).toBe("unconfirmed");
      expect(result.tone).not.toBe("success");
    }
  });
  it("서버 초안과 제출한 답안을 구분한다", (): void => {
    expect(savePresentation({ kind: "saved", version: 3 }).persistence).toBe("draft");
    expect(savePresentation({ kind: "submitted", version: 4 }).persistence).toBe("answer");
    expect(savePresentation({ kind: "submitted", version: 4 }).detail).toContain("AI 처리와 결과 확정은 별도");
  });
  it("유효한 서버 판이 없는 저장 확인을 거부한다", (): void => {
    for (const version of [0, -1, NaN, 1.5, Infinity]) expect(() => savePresentation({ kind: "saved", version })).toThrow(RangeError);
  });
});
