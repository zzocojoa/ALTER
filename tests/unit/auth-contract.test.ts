import { beforeEach, expect, test, vi } from "vitest";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { GET as session } from "../../app/api/session/route";
import { GET as download, PUT as upload, DELETE as remove } from "../../app/api/files/[id]/route";
import { POST as probe } from "../../app/api/storage/probe/route";
import { checkStorageAction } from "../../app/learn/storage-action";
import LearningSpace from "../../app/learn/page";
import type { ChatGPTUser } from "../../app/chatgpt-auth";

const fixture = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  prepare: vi.fn(), get: vi.fn(), put: vi.fn(), delete: vi.fn(),
}));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: vi.fn().mockResolvedValue(null) }));
vi.mock("next/headers", () => ({ headers: fixture.headers }));
vi.mock("next/navigation", () => ({
  unauthorized: (): never => { throw new Error("fixture-http-401"); },
  forbidden: (): never => { throw new Error("fixture-http-403"); },
  redirect: (): never => { throw new Error("fixture-redirect"); },
}));
vi.mock("cloudflare:workers", () => ({ env: {
  ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", ALTER_LOCAL_MOCK_AUTH: "0",
  DB: { prepare: fixture.prepare, batch: vi.fn() },
  BUCKET: { get: fixture.get, put: fixture.put, delete: fixture.delete },
} }));

beforeEach(() => { vi.clearAllMocks(); });

function trustedHeaders(userId: string): Headers {
  return new Headers({ "oai-authenticated-user-id": userId, "oai-authenticated-user-email": "same@example.test", origin: "https://alter.test" });
}

function expectNoStorageCalls(): void {
  for (const spy of [fixture.prepare, fixture.get, fixture.put, fixture.delete]) expect(spy).not.toHaveBeenCalled();
}

test("실제 helper가 플랫폼 헤더 계약을 해석한다", async () => {
  fixture.headers.mockResolvedValue(trustedHeaders("owner-test"));
  const identity: ChatGPTUser | null = await getChatGPTUser();
  expect(identity).toMatchObject({ userId: "owner-test", email: "same@example.test" });
});

test.each([new Headers(), new Headers({ "oai-authenticated-user-id": "owner-test" }), new Headers({ "oai-authenticated-user-email": "same@example.test" })])("필수 신원 누락은 페이지와 API를 차단한다", async (headers: Headers) => {
  fixture.headers.mockResolvedValue(headers);
  expect(await getChatGPTUser()).toBeNull();
  expect((await session()).status).toBe(401);
  await expect(LearningSpace()).rejects.toThrow("fixture-http-401");
  expectNoStorageCalls();
});

test("helper 오류는 보호된 모든 진입점에서 전파되고 저장소를 호출하지 않는다", async () => {
  const failure: Error = new Error("synthetic request context failure");
  fixture.headers.mockRejectedValue(failure);
  const context = { params: Promise.resolve({ id: "2098834d-60e9-4e33-a856-b381fbca16ef" }) };
  const request: Request = new Request("https://alter.test/api/files/test", { method: "PUT", headers: { origin: "https://alter.test" }, body: "synthetic" });
  await expect(getChatGPTUser()).rejects.toBe(failure);
  await expect(session()).rejects.toBe(failure);
  await expect(download(request, context)).rejects.toBe(failure);
  await expect(upload(request, context)).rejects.toBe(failure);
  await expect(remove(request, context)).rejects.toBe(failure);
  await expect(probe(request)).rejects.toBe(failure);
  await expect(checkStorageAction()).rejects.toBe(failure);
  await expect(LearningSpace()).rejects.toBe(failure);
  expectNoStorageCalls();
});

test("같은 모듈에서 소유자→다른 계정→신원 없음→소유자로 바뀌어도 권한을 재사용하지 않는다", async () => {
  const cases: readonly Readonly<{ headers: Headers; status: number }>[] = [
    { headers: trustedHeaders("owner-test"), status: 200 },
    { headers: trustedHeaders("other-test"), status: 403 },
    { headers: new Headers(), status: 401 },
    { headers: trustedHeaders("owner-test"), status: 200 },
  ];
  for (const item of cases) {
    fixture.headers.mockResolvedValue(item.headers);
    const response: Response = await session();
    expect(response.status).toBe(item.status);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    const body: string = await response.text();
    expect(body).not.toContain("owner-test");
    expect(body).not.toContain("same@example.test");
    if (item.status !== 200) expect(body).not.toContain('"authenticated":true');
  }
  expectNoStorageCalls();
});

test("다른 계정 신원은 페이지·파일·서버 작업 전에 거부된다", async () => {
  fixture.headers.mockResolvedValue(trustedHeaders("other-test"));
  const context = { params: Promise.resolve({ id: "2098834d-60e9-4e33-a856-b381fbca16ef" }) };
  const request: Request = new Request("https://alter.test/api/files/test", { method: "PUT", headers: { origin: "https://alter.test" }, body: "synthetic" });
  for (const route of [download, upload, remove]) expect((await route(request, context)).status).toBe(403);
  expect((await probe(request)).status).toBe(403);
  await expect(checkStorageAction()).rejects.toThrow("HTTP 403");
  await expect(LearningSpace()).rejects.toThrow("fixture-http-403");
  expectNoStorageCalls();
});
