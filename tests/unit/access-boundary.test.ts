import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as aiStatus } from "../../app/api/ai/requests/[key]/route";
import { GET as session } from "../../app/api/session/route";
import { GET as download, PUT as upload, DELETE as remove } from "../../app/api/files/[id]/route";
import { POST as dataCheck } from "../../app/api/storage/data-check/route";
import { POST as probe } from "../../app/api/storage/probe/route";
import { checkStorageAction } from "../../app/learn/storage-action";

const fixture = vi.hoisted(() => ({
  identity: vi.fn(),
  prepare: vi.fn(),
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
  env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", ALTER_LOCAL_MOCK_AUTH: "0" },
}));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ...fixture.env, DB: { prepare: fixture.prepare, batch: vi.fn() }, BUCKET: { get: fixture.get, put: fixture.put, delete: fixture.delete } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: "https://alter.test" }) }));

beforeEach(() => { vi.clearAllMocks(); });

describe("진입점별 부수 효과 차단", () => {
  it.each([null, { userId: "other-account", email: "owner@example.test" }])("거부된 신원은 D1·R2에 도달하지 않는다: %j", async (identity) => {
    fixture.identity.mockResolvedValue(identity);
    const context = { params: Promise.resolve({ id: "2098834d-60e9-4e33-a856-b381fbca16ef" }) };
    const request = new Request("https://alter.test/api/files/id", { method: "PUT", headers: { origin: "https://alter.test" }, body: "forged" });
    const expected: number = identity === null ? 401 : 403;
    expect((await session()).status).toBe(expected);
    expect((await aiStatus(request, { params: Promise.resolve({ key: "request-1" }) })).status).toBe(expected);
    expect((await download(request, context)).status).toBe(expected);
    expect((await upload(request, context)).status).toBe(expected);
    expect((await remove(request, context)).status).toBe(expected);
    expect((await probe(request)).status).toBe(expected);
    expect((await dataCheck(request)).status).toBe(expected);
    await expect(checkStorageAction()).rejects.toThrow(`HTTP ${expected}`);
    for (const spy of [fixture.prepare, fixture.get, fixture.put, fixture.delete]) expect(spy).not.toHaveBeenCalled();
  });
  it("소유자의 교차 출처 요청도 저장소 호출 전에 거부한다", async () => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@example.test" });
    const response = await probe(new Request("https://alter.test/api/storage/probe", { method: "POST", headers: { origin: "https://evil.test" } }));
    expect(response.status).toBe(403);
    expect((await dataCheck(new Request("https://alter.test/api/storage/data-check", { method: "POST", headers: { origin: "https://evil.test" } }))).status).toBe(403);
    expect(fixture.prepare).not.toHaveBeenCalled();
    expect(fixture.put).not.toHaveBeenCalled();
  });
});
