import { beforeEach, expect, test, vi } from "vitest";
import { POST } from "../../app/api/setup/candidate/route";

const fixture = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  first: vi.fn(), bind: vi.fn(), prepare: vi.fn(),
  bindings: { ALTER_OWNER_USER_ID: undefined as string | undefined, ALTER_OWNER_ENROLLMENT_EXPIRES_AT: "2099-01-01T00:00:00Z", ALTER_SITE_ORIGIN: "https://alter.test" },
}));
vi.mock("next/headers", () => ({ headers: fixture.headers }));
vi.mock("cloudflare:workers", () => ({ env: {
  get ALTER_OWNER_USER_ID(): string | undefined { return fixture.bindings.ALTER_OWNER_USER_ID; },
  get ALTER_OWNER_ENROLLMENT_EXPIRES_AT(): string { return fixture.bindings.ALTER_OWNER_ENROLLMENT_EXPIRES_AT; },
  ALTER_SITE_ORIGIN: "https://alter.test",
  DB: { prepare: fixture.prepare, batch: vi.fn() },
  BUCKET: { get: vi.fn(), put: vi.fn(), delete: vi.fn() },
} }));

beforeEach(() => {
  vi.clearAllMocks();
  fixture.bindings.ALTER_OWNER_USER_ID = undefined;
  fixture.bindings.ALTER_OWNER_ENROLLMENT_EXPIRES_AT = "2099-01-01T00:00:00Z";
  fixture.headers.mockResolvedValue(new Headers({ "oai-authenticated-user-id": "target-confirmed-user", "oai-authenticated-user-email": "owner@example.test" }));
  fixture.prepare.mockReturnValue({ bind: fixture.bind });
  fixture.bind.mockReturnValue({ first: fixture.first });
  fixture.first.mockResolvedValue({ slot: 1 });
});

function request(origin: string): Request {
  return new Request("https://alter.test/api/setup/candidate", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ candidateId: "caller-forged-user" }) });
}

test("확인된 본인 후보만 반환하고 요청 본문의 식별자와 이메일을 노출하지 않는다", async () => {
  const response: Response = await POST(request("https://alter.test"));
  expect(response.status).toBe(202);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  const body: string = await response.text();
  expect(JSON.parse(body)).toMatchObject({ candidateId: "target-confirmed-user", accessGranted: false });
  expect(body).not.toContain("caller-forged-user");
  expect(body).not.toContain("owner@example.test");
  expect(fixture.bind).toHaveBeenCalledWith("target-confirmed-user", expect.any(Number));
});

test("다른 후보가 먼저 기록돼 있으면 식별자를 반환하지 않는다", async () => {
  fixture.first.mockResolvedValue(null);
  const response: Response = await POST(request("https://alter.test"));
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "different_candidate_already_recorded" });
});

test("교차 출처와 미인증 요청은 후보 저장 전에 차단한다", async () => {
  expect((await POST(request("https://outside.test"))).status).toBe(403);
  fixture.headers.mockResolvedValue(new Headers());
  expect((await POST(request("https://alter.test"))).status).toBe(401);
  expect(fixture.prepare).not.toHaveBeenCalled();
});

test.each(["owner-set", "expired"])("소유자 확정 또는 기간 종료 시 후보 확인이 닫힌다: %s", async (mode: string) => {
  if (mode === "owner-set") fixture.bindings.ALTER_OWNER_USER_ID = "confirmed-owner";
  else fixture.bindings.ALTER_OWNER_ENROLLMENT_EXPIRES_AT = "2000-01-01T00:00:00Z";
  expect((await POST(request("https://alter.test"))).status).toBe(404);
  expect(fixture.headers).not.toHaveBeenCalled();
  expect(fixture.prepare).not.toHaveBeenCalled();
});
