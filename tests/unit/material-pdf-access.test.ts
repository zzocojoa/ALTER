import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/storage/pdf-check/route";

vi.mock("../../lib/materials/pdf-wasm/validator.wasm", () => ({ default: {} }));
const fixture = vi.hoisted(() => ({ identity: vi.fn(), parse: vi.fn() }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test" } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../lib/materials/pdf-probe-storage", () => ({ probePdfContent: fixture.parse }));
beforeEach(() => { vi.clearAllMocks(); });
function request(headers: HeadersInit): Request { return new Request("https://alter.test/api/storage/pdf-check", { method: "POST", headers, body: new Uint8Array([0]) }); }
describe("운영 PDF 검사 접근 경계", () => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@test.invalid" }, status: 403 }])("잘못된 신원에서는 PDF 파서를 실행하지 않는다", async ({ identity, status }) => {
    fixture.identity.mockResolvedValue(identity);
    expect((await POST(request({ origin: "https://alter.test" }))).status).toBe(status);
    expect(fixture.parse).not.toHaveBeenCalled();
  });
  it.each([null, "https://other.test"])("소유자라도 출처가 다르면 거부한다", async (origin) => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    const headers: Headers = new Headers(); if (origin !== null) headers.set("origin", origin);
    expect((await POST(request(headers))).status).toBe(403); expect(fixture.parse).not.toHaveBeenCalled();
  });
  it("이전 PDF 진단 쓰기는 종료되어 소유자도 저장소를 사용하지 않는다", async () => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    expect((await POST(request({ origin: "https://alter.test" }))).status).toBe(410);
    expect(fixture.parse).not.toHaveBeenCalled();
  });
});
