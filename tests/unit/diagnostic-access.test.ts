import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as dataCheck } from "../../app/api/storage/data-check/route";
import { POST as ledgerCheck } from "../../app/api/ai/ledger-check/route";
import { diagnosticFailure, RESTORE_DIAGNOSTIC_MESSAGE } from "../../lib/diagnostic-message";

const fixture = vi.hoisted(() => ({ identity: vi.fn(), restore: vi.fn(), data: vi.fn(), ledger: vi.fn(), prepare: vi.fn(), batch: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner", ALTER_SITE_ORIGIN: "https://alter.test", DB: { prepare: fixture.prepare, batch: fixture.batch }, BUCKET: { get: vi.fn(), put: vi.fn(), delete: vi.fn() } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: fixture.identity }));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: fixture.restore }));
vi.mock("../../lib/data-acceptance", () => ({ runDataAcceptance: fixture.data }));
vi.mock("../../lib/ai/ledger-acceptance", () => ({ runAiLedgerAcceptance: fixture.ledger }));

beforeEach(() => { vi.clearAllMocks(); fixture.identity.mockResolvedValue({ userId: "owner", email: "owner@example.test" }); fixture.restore.mockResolvedValue(null); });
const request = (): Request => new Request("https://alter.test/api/storage/data-check", { method: "POST", headers: { origin: "https://alter.test" } });

describe("복원 환경 진단 진입점", () => {
  it.each([dataCheck, ledgerCheck])("활성화된 복원도 진단 기록 생성 전 423으로 거부한다", async handler => {
    fixture.restore.mockResolvedValue({ learning: "active", externalAuthority: "unverified", runId: "fixture", activatedAt: 1 });
    const response = await handler(request());
    expect(response.status).toBe(423);
    expect(await response.json()).toEqual({ error: "restore_diagnostic_unavailable", message: RESTORE_DIAGNOSTIC_MESSAGE });
    for (const spy of [fixture.data, fixture.ledger, fixture.prepare, fixture.batch]) expect(spy).not.toHaveBeenCalled();
    expect(diagnosticFailure(response.status).message).toContain("임시 기록은 만들지 않았어요");
  });
  it.each([dataCheck, ledgerCheck])("원본 환경은 기존 진단을 실행한다", async handler => {
    fixture.data.mockResolvedValue({ status: "passed" }); fixture.ledger.mockResolvedValue({ status: "passed" });
    expect((await handler(request())).status).toBe(200);
    expect(fixture.data.mock.calls.length + fixture.ledger.mock.calls.length).toBe(1);
  });
  it.each([dataCheck, ledgerCheck])("복원 상태 조회 실패를 실행 허용으로 바꾸지 않는다", async handler => {
    fixture.restore.mockRejectedValue(new Error("restore state unavailable"));
    await expect(handler(request())).rejects.toThrow("restore state unavailable");
    expect(fixture.data).not.toHaveBeenCalled(); expect(fixture.ledger).not.toHaveBeenCalled();
  });
});
