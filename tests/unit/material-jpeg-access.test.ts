import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/storage/jpeg-check/route";
import { jpegProbes } from "../../lib/materials/jpeg-probe";

vi.mock("../../lib/materials/jpeg-wasm/decoder.wasm", () => ({ default: {} }));
const fixture = vi.hoisted(() => ({ identity: vi.fn(), parse: vi.fn() }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test" } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../lib/materials/jpeg-content", () => ({ validateJpegContent: fixture.parse }));
const invalidRequests: readonly Readonly<{ headers: Record<string, string>; status: number }>[] = [
  { headers: { "x-jpeg-probe": "unknown", "content-type": "image/jpeg" }, status: 400 },
  { headers: { "x-jpeg-probe": "maximum-pixels-baseline", "content-type": "text/plain" }, status: 415 },
  { headers: { "x-jpeg-probe": "maximum-pixels-baseline", "content-type": "image/jpeg", "content-length": "1" }, status: 400 },
];
beforeEach(() => { vi.clearAllMocks(); });
function request(headers: HeadersInit): Request { return new Request("https://alter.test/api/storage/jpeg-check", { method: "POST", headers, body: new Uint8Array([0]) }); }
describe("운영 JPEG 검사 접근 경계", () => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@test.invalid" }, status: 403 }])("잘못된 신원에서는 이미지 파서를 실행하지 않는다", async ({ identity, status }) => {
    fixture.identity.mockResolvedValue(identity);
    expect((await POST(request({ origin: "https://alter.test" }))).status).toBe(status);
    expect(fixture.parse).not.toHaveBeenCalled();
  });
  it.each([null, "https://other.test"])("소유자라도 출처가 다르면 거부한다", async (origin) => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    const headers: Headers = new Headers(); if (origin !== null) headers.set("origin", origin);
    expect((await POST(request(headers))).status).toBe(403); expect(fixture.parse).not.toHaveBeenCalled();
  });
  it.each(invalidRequests)("예정된 합성 파일의 요청 계약을 벗어나면 거부한다", async ({ headers, status }) => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    expect((await POST(request({ origin: "https://alter.test", ...headers }))).status).toBe(status); expect(fixture.parse).not.toHaveBeenCalled();
  });
  it("소유자에게도 서버에 고정된 메타데이터를 적용한다", async () => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" }); fixture.parse.mockResolvedValue({ checked: true });
    const response: Response = await POST(request({ origin: "https://alter.test", "content-type": "image/jpeg", "x-jpeg-probe": "maximum-pixels-baseline" }));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fixture.parse).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bytes: jpegProbes[0].bytes, sha256: jpegProbes[0].sha256 }), expect.any(AbortSignal), expect.anything());
  });
});
