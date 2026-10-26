import { describe, expect, it } from "vitest";
import { prepareGoogleRestRequest } from "../../lib/google/rest-request.ts";
import { googleRestRetryDelay, googleRetryAfter, sendGoogleRestAttempt } from "../../lib/google/rest-transport.ts";
import type { GoogleRestFailure, GoogleRestRuntime } from "../../lib/google/rest-transport.ts";

const now: number = Date.parse("2026-10-25T00:00:00Z");
const runtime = (response: () => Promise<Response>): GoogleRestRuntime => ({ fetch: response, now: () => now, wait: async () => {}, warn: () => {} });
describe("Google REST 허용 요청과 응답", () => {
  it("고정 엔드포인트·최소 fields·RAW 쓰기를 구성하고 URL·역할 위조를 거부한다", async () => {
    const file = await prepareGoogleRestRequest({ method: "drive.files.get", fileId: "selected-doc" }, "reference");
    expect(file.url).toMatch(/^https:\/\/www.googleapis.com\/drive\/v3\/files\/selected-doc\?fields=/);
    await expect(prepareGoogleRestRequest({ method: "drive.files.get", fileId: "https://evil.test" }, "reference")).rejects.toThrow();
    await expect(prepareGoogleRestRequest({ method: "docs.documents.create", title: "제목" }, "reference")).rejects.toThrow();
    const sheet = await prepareGoogleRestRequest({ method: "sheets.values.append", spreadsheetId: "sheet", range: "주간!A1:C1", values: [["=danger()", "내용", 1]] }, "sheets-target");
    expect(sheet.url).toContain("valueInputOption=RAW"); expect(JSON.parse(sheet.body ?? "{}").values[0][0]).toBe("=danger()");
    await expect(prepareGoogleRestRequest({ method: "calendar.events.get", calendarId: "primary", eventId: "abcde1234" }, "calendar-target")).rejects.toThrow();
  });
  it("토큰은 헤더에만 보내고 응답에 포함하지 않는다", async () => {
    const request = await prepareGoogleRestRequest({ method: "drive.about.get" }, "account");
    const result = await sendGoogleRestAttempt({ ...runtime(async () => Response.json({ storageQuota: { limit: "10", usage: "1" } })), fetch: async (url, init) => { expect(url).not.toContain("secret-token"); expect(new Headers(init.headers).get("authorization")).toBe("Bearer secret-token"); expect(init.redirect).toBe("manual"); expect(init.cache).toBe("no-store"); return Response.json({ storageQuota: { limit: "10", usage: "1" } }); } }, request, "secret-token");
    expect(JSON.stringify(result)).not.toContain("secret-token");
  });
  it.each([[401, "invalid_token", "unauthorized"], [403, "accessNotConfigured", "api-disabled"], [403, "storageQuotaExceeded", "storage-full"], [403, "dailyLimitExceeded", "quota"], [429, "rateLimitExceeded", "quota"], [404, "notFound", "not-found"], [412, "conditionNotMet", "conflict"], [503, "backendError", "server"]])("HTTP %s를 구분하고 제공사 비밀 문구를 제거한다", async (status, reason, expected) => {
    const request = await prepareGoogleRestRequest({ method: "drive.about.get" }, "account");
    try { await sendGoogleRestAttempt(runtime(async () => Response.json({ error: { message: "secret-token authorization-code private-document", errors: [{ reason }] } }, { status: Number(status) })), request, "secret-token"); throw new Error("오류 누락"); }
    catch (error: unknown) { expect(error).toMatchObject({ code: "google_rest_failed", status, reason: expected, method: "drive.about.get", requestHash: request.hash }); expect(String(error) + JSON.stringify(error)).not.toMatch(/secret-token|authorization-code|private-document/); }
  });
  it("조회 재시도는 3회 이내이며 Retry-After가 30초를 넘으면 중단한다", async () => {
    const request = await prepareGoogleRestRequest({ method: "drive.about.get" }, "account");
    let failure: GoogleRestFailure | null = null;
    try { await sendGoogleRestAttempt(runtime(async () => Response.json({ error: {} }, { status: 429, headers: { "Retry-After": "5" } })), request, "token"); } catch (error: unknown) { failure = error as GoogleRestFailure; }
    if (failure === null) throw new Error("오류 누락");
    expect(googleRestRetryDelay(request, failure, 1)).toBe(5000); expect(googleRestRetryDelay(request, failure, 3)).toBeNull();
    expect(googleRestRetryDelay(request, { ...failure, retryAfterMs: 31_000 }, 1)).toBeNull();
    expect(googleRestRetryDelay(request, { ...failure, status: 403 }, 1)).toBeNull();
    expect(googleRetryAfter(new Date(now + 10_000).toUTCString(), now)).toBe(10_000);
    expect(googleRetryAfter("invalid", now)).toBeNull();
  });
  it("쓰기 응답 유실·5xx·손상 응답은 미확정이며 자동 재전송하지 않는다", async () => {
    const request = await prepareGoogleRestRequest({ method: "docs.documents.create", title: "시험" }, "docs-create");
    for (const response of [async (): Promise<Response> => { throw new TypeError("secret-token lost"); }, async (): Promise<Response> => Response.json({ error: {} }, { status: 503 }), async (): Promise<Response> => Response.json({ unexpected: true })]) {
      try { await sendGoogleRestAttempt(runtime(response), request, "token"); throw new Error("오류 누락"); }
      catch (error: unknown) { expect(error).toMatchObject({ code: "google_rest_failed", outcome: "unknown" }); expect(googleRestRetryDelay(request, error as GoogleRestFailure, 1)).toBeNull(); }
    }
  });
  it("읽기 응답의 상한·MIME·JSON·UTF-8 오류를 구분된 실패로 반환한다", async () => {
    const request = await prepareGoogleRestRequest({ method: "drive.about.get" }, "account");
    for (const response of [new Response("invalid", { headers: { "content-type": "text/html" } }), new Response("{", { headers: { "content-type": "application/json" } }), new Response(new Uint8Array([255]), { headers: { "content-type": "application/json" } }), new Response("{}", { headers: { "content-type": "application/json", "content-length": "5000000" } })]) await expect(sendGoogleRestAttempt(runtime(async () => response), request, "token")).rejects.toMatchObject({ reason: "invalid-response" });
  });
});
