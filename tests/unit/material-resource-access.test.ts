import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "../../app/api/storage/material-check/route";

const fixture = vi.hoisted(() => ({ identity: vi.fn(), list: vi.fn(), create: vi.fn() }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", BUCKET: { list: fixture.list, createMultipartUpload: fixture.create } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
beforeEach(() => { vi.clearAllMocks(); });

describe("운영 자료 전송 진단의 접근 경계", () => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@test.invalid" }, status: 403 }])("잘못된 신원에서 저장소를 사용하지 않는다", async ({ identity, status }) => {
    fixture.identity.mockResolvedValue(identity);
    const response: Response = await POST(new Request("https://alter.test/api/storage/material-check", { method: "POST", headers: { origin: "https://alter.test" } }));
    expect(response.status).toBe(status); expect(fixture.list).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it.each([null, "https://other.test"])("소유자라도 잘못된 출처를 거부한다", async (origin) => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    const headers: Headers = new Headers();
    if (origin !== null) headers.set("origin", origin);
    const response: Response = await POST(new Request("https://alter.test/api/storage/material-check", { method: "POST", headers }));
    expect(response.status).toBe(403); expect(fixture.list).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
  it("이전 진단 쓰기는 종료되어 소유자도 저장소를 사용하지 않는다", async () => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    const response: Response = await POST(new Request("https://alter.test/api/storage/material-check", { method: "POST", headers: { origin: "https://alter.test" } }));
    expect(response.status).toBe(410); expect(fixture.list).not.toHaveBeenCalled(); expect(fixture.create).not.toHaveBeenCalled();
  });
});
