import { describe, expect, it } from "vitest";
import { originalErrorText, originalFailure } from "../../app/learn/materials/original-failure";
import { requireMaterialResponse } from "../../app/learn/materials/client-api";

describe("원본 오류 안내 경계", (): void => {
  it("서버 내부 코드와 원본 URL을 화면 문구로 전달하지 않는다", async (): Promise<void> => {
    try { await requireMaterialResponse(new Response(JSON.stringify({ error: "https://private.invalid/secret" }), { status: 403, headers: { "content-type": "application/json" } })); throw new Error("오류가 발생해야 합니다."); }
    catch (error: unknown) { expect(originalErrorText(error)).toContain("HTTP 403"); expect(originalErrorText(error)).not.toContain("private.invalid"); }
    expect(originalErrorText(new Error("Unexpected server response for https://private.invalid/secret"))).not.toContain("private.invalid");
  });
  it("직접 정의한 원본 안내와 네트워크 실패를 구분한다", (): void => {
    expect(originalErrorText(originalFailure("PDF가 손상되어 읽을 수 없어요."))).toBe("PDF가 손상되어 읽을 수 없어요.");
    expect(originalErrorText(new TypeError("Failed to fetch"))).toContain("네트워크");
  });
});
