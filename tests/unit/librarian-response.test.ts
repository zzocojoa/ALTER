import { afterEach, expect, it, vi } from "vitest";
import { librarianJson, LibrarianRequestError } from "../../app/learn/library/client-api";

afterEach((): void => { vi.unstubAllGlobals(); });
for (const status of [401, 403, 503]) for (const content of [{ type: "text/html", body: "<html>failure</html>" }, { type: "application/json", body: "" }, { type: "application/json", body: "{}" }]) {
  it(`HTTP ${status} · ${content.type} · ${content.body.length}: 오류 본문 형식이 달라도 권한 상태와 원인을 보존`, async (): Promise<void> => {
    vi.stubGlobal("fetch", vi.fn(async (): Promise<Response> => new Response(content.body, { status, headers: { "content-type": content.type } })));
    const outcome = librarianJson("/api/tutor", { method: "GET" });
    await expect(outcome).rejects.toBeInstanceOf(LibrarianRequestError);
    await expect(outcome).rejects.toMatchObject({ status, code: "invalid_error_response", aiStartRejection: null, cause: expect.any(Error) });
  });
}
it("형식이 잘못된 시작 거부 증거는 HTTP 오류를 보존하지만 잠금 해제 근거로 쓰지 않는다", async (): Promise<void> => {
  vi.stubGlobal("fetch", vi.fn(async (): Promise<Response> => Response.json({ error: "version_conflict", aiStartRejection: { status: "not-started" } }, { status: 409 })));
  await expect(librarianJson("/api/editor", { method: "POST" })).rejects.toMatchObject({ status: 409, aiStartRejection: null });
});
