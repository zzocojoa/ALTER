import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/storage/material-state-check/route";

const fixture = vi.hoisted(() => ({ identity: vi.fn(), check: vi.fn() }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", DB: { prepare: vi.fn(), batch: vi.fn() }, BUCKET: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../lib/materials/state-acceptance", () => ({ runMaterialStateAcceptance: fixture.check }));
beforeEach(() => { vi.clearAllMocks(); });
function request(origin: string | null): Request { return new Request("https://alter.test/api/storage/material-state-check", { method: "POST", headers: origin === null ? {} : { origin } }); }
describe("자료 상태 진단의 접근 경계", () => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@test.invalid" }, status: 403 }])("소유자 외 요청에서 D1 검사를 실행하지 않는다", async ({ identity, status }) => {
    fixture.identity.mockResolvedValue(identity);
    expect((await POST(request("https://alter.test"))).status).toBe(status); expect(fixture.check).not.toHaveBeenCalled();
  });
  it.each([null, "https://other.test"])("출처가 다르거나 없으면 D1 검사를 실행하지 않는다", async (origin) => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    expect((await POST(request(origin))).status).toBe(403); expect(fixture.check).not.toHaveBeenCalled();
  });
  it("확인한 소유자에게 캐시되지 않는 검사 결과를 반환한다", async () => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" }); fixture.check.mockResolvedValue({ status: "passed" });
    const response: Response = await POST(request("https://alter.test"));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store"); expect(fixture.check).toHaveBeenCalledWith(expect.objectContaining({ prepare: expect.any(Function), batch: expect.any(Function) }), "hosted-d1");
  });
});
