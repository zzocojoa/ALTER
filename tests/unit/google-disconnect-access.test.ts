import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/google/disconnect/route";

const fixture = vi.hoisted(() => ({ identity: vi.fn(), disconnect: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", DB: {} } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("../../lib/google/disconnect", () => ({ disconnectGoogle: fixture.disconnect }));
beforeEach(() => { vi.clearAllMocks(); });
function request(origin: string | null, body: unknown): Request {
  const headers = new Headers({ "content-type": "application/json" });
  if (origin !== null) headers.set("origin", origin);
  return new Request("https://alter.test/api/google/disconnect", { method: "POST", headers, body: JSON.stringify(body) });
}
const target = { connectionId: "00000000-0000-4000-a000-000000001499", generation: 3 };
describe("중단된 Google 해제 복구의 POST 접근 경계", () => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@example.test" }, status: 403 }])("비소유자는 복구를 실행하지 못한다", async ({ identity, status }) => {
    fixture.identity.mockResolvedValue(identity);
    expect((await POST(request("https://alter.test", target))).status).toBe(status);
    expect(fixture.disconnect).not.toHaveBeenCalled();
  });
  it.each([null, "https://other.test"])("출처가 없거나 다르면 소유자도 복구하지 못한다", async origin => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@example.test" });
    expect((await POST(request(origin, target))).status).toBe(403);
    expect(fixture.disconnect).not.toHaveBeenCalled();
  });
  it("동일 출처 소유자의 복구는 암호화 키가 없어도 현재 세대로 실행한다", async () => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@example.test" });
    fixture.disconnect.mockResolvedValue({ local: "disconnected", provider: "unknown", status: null, issue: "interrupted-disconnect-recovered" });
    const response = await POST(request("https://alter.test", target));
    expect(response.status).toBe(200);
    expect(fixture.disconnect).toHaveBeenCalledWith({}, { realm: "sites", userId: "owner-test" }, null, expect.any(Object), target);
    expect(await response.json()).toMatchObject({ local: "disconnected", provider: "unknown" });
  });
});
