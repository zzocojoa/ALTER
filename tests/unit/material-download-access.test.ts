import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "../../app/api/materials/[id]/file/route";
const fixture = vi.hoisted(() => ({ identity: vi.fn(), get: vi.fn(), read: vi.fn(), head: vi.fn(), exposure: vi.fn(), visibility: vi.fn() }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", DB: { prepare: vi.fn(), batch: vi.fn() }, BUCKET: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../db/repositories/material-access", () => ({ recordMaterialExposure: fixture.exposure, requireMaterialVisibility: fixture.visibility }));
vi.mock("../../lib/materials/download", () => ({ getRegisteredMaterial: fixture.get, readMaterialFile: fixture.read, headMaterialFile: fixture.head }));
const id: string = "8f58541a-780e-4b2d-a508-a8759744930b";
beforeEach((): void => { vi.clearAllMocks(); });
describe("원본 GET·HEAD·Range 인증", (): void => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@test.invalid" }, status: 403 }])("비로그인·다른 계정은 저장소 읽기 전에 거부한다", async ({ identity, status }): Promise<void> => {
    fixture.identity.mockResolvedValue(identity);
    const request = new Request(`https://alter.test/api/materials/${id}/file`, { headers: { range: "bytes=0-9" } });
    expect((await GET(request, { params: Promise.resolve({ id }) })).status).toBe(status);
    const head = await HEAD(request, { params: Promise.resolve({ id }) });
    expect(head.status).toBe(status); expect(await head.text()).toBe("");
    expect(fixture.get).not.toHaveBeenCalled(); expect(fixture.read).not.toHaveBeenCalled(); expect(fixture.head).not.toHaveBeenCalled();
  });
  it("소유자의 자료 ID로만 확정 자료를 조회한다", async (): Promise<void> => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" }); fixture.get.mockResolvedValue({ id }); fixture.read.mockResolvedValue(new Response("original"));
    const request = new Request(`https://alter.test/api/materials/${id}/file?objectKey=other&disposition=attachment`);
    expect(await (await GET(request, { params: Promise.resolve({ id }) })).text()).toBe("original");
    expect(fixture.get).toHaveBeenCalledWith(expect.anything(), { realm: "sites", userId: "owner-test" }, id);
    expect(fixture.read).toHaveBeenCalledWith(expect.anything(), { id }, request, "attachment");
  });
});
