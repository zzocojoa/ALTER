import { describe, expect, it } from "vitest";
import { readBoundedGoogleJson } from "../../lib/google/response.ts";
import { readBoundedJson } from "../../lib/materials/request.ts";

describe("Google 압축 응답 JSON", () => {
  it("Fetch가 해제한 본문과 압축 전송 길이를 비교하지 않고 한 번만 읽는다", async () => {
    for (const encoding of ["gzip", "br", "deflate"]) {
      const response: Response = new Response('{"message":"가나다라마바사"}', { headers: { "content-type": "application/json; charset=UTF-8", "content-length": "12", "content-encoding": encoding } });
      await expect(readBoundedGoogleJson(response, 100)).resolves.toEqual({ message: "가나다라마바사" });
      expect(response.bodyUsed).toBe(true);
      expect(response.headers.get("content-length")).toBe("12");
    }
  });
  it("압축 본문도 실제 바이트 상한·UTF-8·JSON·인코딩 검사를 유지한다", async () => {
    const headers: HeadersInit = { "content-type": "application/json", "content-encoding": "gzip", "content-length": "1" };
    await expect(readBoundedGoogleJson(new Response('{"value":"' + "가".repeat(100) + '"}', { headers }), 100)).rejects.toMatchObject({ code: "material_request_invalid" });
    await expect(readBoundedGoogleJson(new Response(new Uint8Array([255]), { headers }), 100)).rejects.toThrow();
    await expect(readBoundedGoogleJson(new Response("invalid", { headers }), 100)).rejects.toThrow();
    await expect(readBoundedGoogleJson(new Response("{}", { headers: { ...headers, "content-encoding": "unknown" } }), 100)).rejects.toThrow();
  });
  it("비압축 응답과 업로드 요청의 길이 검사를 완화하지 않는다", async () => {
    const headers: HeadersInit = { "content-type": "application/json", "content-length": "1" };
    await expect(readBoundedGoogleJson(new Response("{}", { headers }), 100)).rejects.toThrow();
    await expect(readBoundedJson(new Response("{}", { headers: { ...headers, "content-encoding": "gzip" } }), 100)).rejects.toThrow();
  });
});
