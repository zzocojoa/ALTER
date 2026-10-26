import { recoverAiResponse } from "../../lib/ai/recover";
import { describe, expect, it, vi } from "vitest";
import { readRestoredExecution, requireCurrentExecutionAuthority } from "../../db/repositories/restore-execution";
import { executeAiAttempt } from "../../lib/ai/attempt";
import { prepareGoogleExecution } from "../../lib/google/execute";
import type { GoogleExecutionSettings, GoogleExecutionRuntime } from "../../lib/google/execute";
import { runExternalOperation } from "../../lib/external/execute";
import { fixturePricing } from "../fixtures/ai-pricing";
import { backupFixtureId } from "../fixtures/backup-files";
import type { SiteIdentity } from "../../lib/domain/contracts";
import { materialErrorResponse } from "../../lib/materials/server-access";
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("next/headers", () => ({ headers: vi.fn() }));
const owner: SiteIdentity = { realm: "sites", userId: "restored-owner" };
const id: string = backupFixtureId(1);
const identity = { projectId: "target-project", databaseId: backupFixtureId(2), bucketId: backupFixtureId(3), owner, purpose: "restore-test" };
function fixture(row: unknown): Readonly<{ db: D1Database; first: ReturnType<typeof vi.fn>; batch: ReturnType<typeof vi.fn> }> {
  const first = vi.fn().mockResolvedValue(row); const batch = vi.fn();
  const db = { prepare: vi.fn(() => ({ first })), batch } as unknown as D1Database;
  return { db, first, batch };
}
const active = { identity: JSON.stringify(identity), storage_state: "ready", run_id: id, owner_id: owner.userId, run_state: "activated", activated_at: 1 };
describe("복원 후 현재 실행 권한", () => {
  it("주 환경은 기존 권한을 유지하며 복원은 활성화 전 격리한다", async () => {
    expect(await readRestoredExecution(fixture(null).db, owner)).toBeNull();
    await expect(requireCurrentExecutionAuthority(fixture(null).db, owner)).resolves.toBeUndefined();
    const db = fixture({ ...active, activated_at: null, run_state: "verified" }).db;
    expect(await readRestoredExecution(db, owner)).toMatchObject({ learning: "quarantined", externalAuthority: "unverified" });
    expect(await readRestoredExecution(fixture(active).db, { realm: "sites", userId: "other-owner" })).toMatchObject({ learning: "quarantined" });
  });
  it("활성화와 재시작 후에도 현재 외부 권한은 미확인이고 423으로 설명한다", async () => {
    for (const db of [fixture(active).db, fixture(active).db]) {
      expect(await readRestoredExecution(db, owner)).toMatchObject({ learning: "active", externalAuthority: "unverified" });
      try { await requireCurrentExecutionAuthority(db, owner); throw new Error("실행이 허용됨"); }
      catch (error: unknown) { expect(materialErrorResponse(error).status).toBe(423); }
    }
  });
  it("상태 조회 장애나 손상을 일반 실행 권한으로 대체하지 않는다", async () => {
    const failure = fixture(active); failure.first.mockRejectedValue(new Error("invalid storage"));
    await expect(requireCurrentExecutionAuthority(failure.db, owner)).rejects.toMatchObject({code: "storage_failure"});
    await expect(requireCurrentExecutionAuthority(fixture({...active, identity: "{}"}).db, owner)).rejects.toThrow();
  });
  it("AI 입력 토큰 조회·키 읽기·예약과 Google OAuth·REST 전에 차단한다", async () => {
    const { db, batch } = fixture(active); const fetch = vi.fn(); const readApiKey = vi.fn(); const checkFunding = vi.fn(); const authorizeSources = vi.fn();
    await expect(executeAiAttempt({ db, authenticate: async () => owner, authorizeSources, checkFunding, readApiKey, now: Date.now, fetch }, { logicalRequestKey: "restored-retry", attemptOrdinal: 1, windowId: id, windowVersion: 1, request: { instructions: "시험", messages: [{ role: "user", content: [{ type: "input_text", text: "분수" }] }], maximumOutputTokens: 64, reasoningEffort: "none" }, pricing: fixturePricing() }, new AbortController().signal)).rejects.toMatchObject({code: "restore_execution_unverified"});
    await expect(recoverAiResponse({db, authenticate: async () => owner, readApiKey, fetch, now: Date.now, loadContext: vi.fn()}, id, "diagnostic-question", new AbortController().signal)).rejects.toMatchObject({code: "restore_execution_unverified"});
    const settings = new Proxy({} as GoogleExecutionSettings, { get(): never { throw new Error("Google 설정 접근 금지"); } });
    const runtime = new Proxy({} as GoogleExecutionRuntime, { get(): never { throw new Error("Google 전송 접근 금지"); } });
    await expect(prepareGoogleExecution(db, owner, settings, {method: "drive.about.get"}, {id, role: "account", storageUpperBytes: 0, selection: null, context: null}, runtime)).rejects.toMatchObject({code: "restore_execution_unverified"});
    for (const spy of [batch, fetch, readApiKey, checkFunding, authorizeSources]) expect(spy).not.toHaveBeenCalled();
  });
  it("이전 작업과 만료 리스를 일반 실행기로 재개해도 조회·쓰기 전송을 하지 않는다", async () => {
    const {db, batch} = fixture(active); const read = vi.fn(); const write = vi.fn();
    await expect(runExternalOperation(db, owner, id, {read, write}, {now: Date.now, id: crypto.randomUUID, requestBudgetMs: 5000, jitter: () => 0, warn: vi.fn()})).rejects.toMatchObject({code: "restore_execution_unverified"});
    for (const spy of [read, write, batch]) expect(spy).not.toHaveBeenCalled();
  });
});
