import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as storageCheck } from "../../app/api/materials/storage-check/route";
import { POST } from "../../app/api/materials/uploads/route";
import { POST as complete } from "../../app/api/materials/uploads/[id]/complete/route";
import { POST as recover } from "../../app/api/materials/uploads/[id]/recover/route";
import { POST as cleanup } from "../../app/api/materials/uploads/[id]/cleanup/route";
import { PUT } from "../../app/api/materials/uploads/[id]/body/route";
import { GET } from "../../app/api/materials/uploads/[id]/route";
import { materialMutationAccess } from "../../lib/materials/server-access";

const fixture = vi.hoisted(() => ({ identity: vi.fn(), start: vi.fn(), get: vi.fn(), upload: vi.fn(), complete: vi.fn(), recover: vi.fn(), cleanup: vi.fn() }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", DB: { prepare: vi.fn(), batch: vi.fn() }, BUCKET: { get: vi.fn(), upload: vi.fn(), complete: vi.fn(), recover: vi.fn(), cleanup: vi.fn(), put: vi.fn(), delete: vi.fn() } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../lib/materials/pdf-wasm/validator.wasm", () => ({ default: {} }));
vi.mock("../../lib/materials/jpeg-wasm/decoder.wasm", () => ({ default: {} }));
vi.mock("../../lib/materials/recovery", () => ({ recoverMaterialTransfer: fixture.recover, cleanupMaterialTransfer: fixture.cleanup }));
vi.mock("../../lib/materials/complete", () => ({ completeMaterialTransfer: fixture.complete }));
vi.mock("../../lib/materials/upload", () => ({ uploadMaterialBody: fixture.upload }));
vi.mock("../../lib/materials/start", () => ({ startMaterialTransfer: fixture.start }));
vi.mock("../../db/repositories/material-transfers", () => ({ getMaterialTransfer: fixture.get }));
const id: string = "21c24a40-bcd6-41c9-8f7b-b5d426e0e38a";
const metadata = { title: "교재", edition: "", role: "reference", kind: "text", filename: "교재.txt", mime: "text/plain", bytes: 10, sha256: "a".repeat(64) };
const body = { courseId: id, metadata };
function request(value: object, origin: string): Request { return new Request("https://alter.test/api/materials/uploads", { method: "POST", headers: { origin, "content-type": "application/json", "idempotency-key": id }, body: JSON.stringify(value) }); }
beforeEach((): void => { vi.clearAllMocks(); });
describe("업로드 경로 인증·출처 경계", (): void => {
  it.each([{ identity: null, status: 401 }, { identity: { userId: "other", email: "other@test.invalid" }, status: 403 }])("비로그인·다른 계정은 시작·상태 읽기를 거부한다", async ({ identity, status }): Promise<void> => {
    fixture.identity.mockResolvedValue(identity);
    expect((await storageCheck(request(body, "https://alter.test"))).status).toBe(status);
    expect((await POST(request(body, "https://alter.test"))).status).toBe(status);
    expect((await GET(request(body, "https://alter.test"), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect((await PUT(request(body, "https://alter.test"), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect((await complete(request(body, "https://alter.test"), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect((await recover(request(body, "https://alter.test"), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect((await cleanup(request(body, "https://alter.test"), { params: Promise.resolve({ id }) })).status).toBe(status);
    expect(fixture.recover).not.toHaveBeenCalled(); expect(fixture.cleanup).not.toHaveBeenCalled();
    expect(fixture.start).not.toHaveBeenCalled(); expect(fixture.get).not.toHaveBeenCalled(); expect(fixture.upload).not.toHaveBeenCalled(); expect(fixture.complete).not.toHaveBeenCalled();
  });
  it.each(["", "https://other.test"])("다른 출처는 원본 쓰기 준비 전에 차단한다", async (origin): Promise<void> => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    expect((await POST(request(body, origin))).status).toBe(403); expect(fixture.start).not.toHaveBeenCalled();
    expect((await recover(request(body, origin), { params: Promise.resolve({ id }) })).status).toBe(403);
    expect((await cleanup(request(body, origin), { params: Promise.resolve({ id }) })).status).toBe(403);
    expect(fixture.recover).not.toHaveBeenCalled(); expect(fixture.cleanup).not.toHaveBeenCalled();
  });
  it.each(["ownerId", "objectKey", "materialId", "uploadId"])("요청에 서버 소유 필드 %s를 끼워 넣지 못한다", async (field): Promise<void> => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    expect((await POST(request({ ...body, [field]: "injected" }, "https://alter.test"))).status).toBe(400); expect(fixture.start).not.toHaveBeenCalled();
  });
  it("시작 응답은 서버 발급 식별자만 공개하고 원본 키는 노출하지 않는다", async (): Promise<void> => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    fixture.start.mockResolvedValue({ id, materialId: id, version: 1, objectKey: "private-key", snapshot: { state: "reserved" } });
    const response: Response = await POST(request(body, "https://alter.test"));
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ id, materialId: id, version: 1, state: "reserved" });
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(fixture.start).toHaveBeenCalledWith(expect.anything(), { realm: "sites", userId: "owner-test" }, id, body, expect.any(Number));
  });
  it.each(["body", "complete", "recover", "cleanup"])("후속 %s 변경도 동일한 소유자·출처 방어를 적용한다", async (action): Promise<void> => {
    fixture.identity.mockResolvedValue({ userId: "owner-test", email: "owner@test.invalid" });
    const result = await materialMutationAccess(new Request(`https://alter.test/api/materials/uploads/${id}/${action}`, { method: "POST", headers: { origin: "https://other.test" } }));
    expect(result.rejection?.status).toBe(403); expect(result.owner).toBeNull();
  });
});
