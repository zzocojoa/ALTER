import { POST as reconcile, GET as reconciliation } from "../../app/api/restore/reconciliation/route";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as registerTarget } from "../../app/api/restore/storage/route";
import { POST as registerSource } from "../../app/api/backup/storage/route";
import { POST as issueChallenge } from "../../app/api/restore/challenges/route";
import { POST as startRestore } from "../../app/api/restore/runs/route";
import { PUT as receiveManifest } from "../../app/api/restore/runs/[id]/manifest/route";
import { PUT as receivePage } from "../../app/api/restore/runs/[id]/pages/[table]/[ordinal]/route";
import { PUT as receiveOriginal } from "../../app/api/restore/runs/[id]/objects/[ordinal]/route";
import { POST as beginImport } from "../../app/api/restore/runs/[id]/import/route";
import { POST as importPage } from "../../app/api/restore/runs/[id]/import/pages/[table]/[ordinal]/route";
import { POST as beginVerification } from "../../app/api/restore/runs/[id]/verify/route";
import { POST as verifyPage } from "../../app/api/restore/runs/[id]/verify/pages/[table]/[ordinal]/route";
import { POST as verifyOriginal } from "../../app/api/restore/runs/[id]/verify/objects/[ordinal]/route";
import { POST as activate } from "../../app/api/restore/runs/[id]/activate/route";
import { POST as finishVerification } from "../../app/api/restore/runs/[id]/verify/complete/route";
import { GET as session } from "../../app/api/session/route";
import { GET as tutor } from "../../app/api/tutor/route";
import { GET as materials } from "../../app/api/materials/route";
import { POST as googleConnect } from "../../app/api/google/oauth/start/route";
import { POST as aiProbe } from "../../app/api/ai/support-check/route";
import { authenticateAiOwner } from "../../lib/ai/server";
import { backupFixtureId } from "../fixtures/backup-files";

const state = vi.hoisted(() => ({
  restored: vi.fn(), identity: vi.fn(), prepare: vi.fn(), batch: vi.fn(), get: vi.fn(), put: vi.fn(), head: vi.fn(), fetch: vi.fn(),
  configuration: undefined as string | undefined,
}));
vi.mock("../../db/repositories/restore-execution", () => ({ readRestoredExecution: state.restored }));
vi.mock("cloudflare:workers", () => ({ env: { ALTER_OWNER_USER_ID: "owner-test", ALTER_SITE_ORIGIN: "https://alter.test", ALTER_LOCAL_MOCK_AUTH: "0", get ALTER_RESTORE_CONFIGURATION() { return state.configuration; }, DB: { prepare: state.prepare, batch: state.batch }, BUCKET: { get: state.get, put: state.put, head: state.head } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: state.identity }));
vi.mock("../../lib/materials/pdf-wasm/validator.wasm", () => ({ default: {} }));
vi.mock("../../lib/materials/jpeg-wasm/decoder.wasm", () => ({ default: {} }));
const source = { projectId: "source-project", databaseId: backupFixtureId(1), bucketId: backupFixtureId(2), owner: { realm: "sites", userId: "source-owner" }, purpose: "primary" };
const targetConfiguration: string = JSON.stringify({ role: "restore-test", source, sourcePublicKey: "configured-public-key", sourceKeySha256: "a".repeat(64) });
function request(origin: string): Request { return new Request("https://alter.test/api/restore/storage", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ owner: "forged", source: "forged" }) }); }
const activationAccess = (request: Request): Promise<Response> => activate(request, { params: Promise.resolve({ id: backupFixtureId(10) }) });
const manifestAccess = (request: Request): Promise<Response> => receiveManifest(request, { params: Promise.resolve({ id: backupFixtureId(10) }) });
const pageAccess = (request: Request): Promise<Response> => receivePage(request, { params: Promise.resolve({ id: backupFixtureId(10), table: "courses", ordinal: "0" }) });
const originalAccess = (request: Request): Promise<Response> => receiveOriginal(request, { params: Promise.resolve({ id: backupFixtureId(10), ordinal: "0" }) });
const importAccess = (request: Request): Promise<Response> => beginImport(request, { params: Promise.resolve({ id: backupFixtureId(10) }) });
const importPageAccess = (request: Request): Promise<Response> => importPage(request, { params: Promise.resolve({ id: backupFixtureId(10), table: "courses", ordinal: "0" }) });
const verificationAccess = (request: Request): Promise<Response> => beginVerification(request, { params: Promise.resolve({ id: backupFixtureId(10) }) });
const verificationPageAccess = (request: Request): Promise<Response> => verifyPage(request, { params: Promise.resolve({ id: backupFixtureId(10), table: "courses", ordinal: "0" }) });
const verificationOriginalAccess = (request: Request): Promise<Response> => verifyOriginal(request, { params: Promise.resolve({ id: backupFixtureId(10), ordinal: "0" }) });
const verificationCompleteAccess = (request: Request): Promise<Response> => finishVerification(request, { params: Promise.resolve({ id: backupFixtureId(10) }) });
function noEffects(): void { for (const spy of [state.prepare, state.batch, state.get, state.put, state.head, state.fetch]) expect(spy).not.toHaveBeenCalled(); }
beforeEach(() => { vi.clearAllMocks(); state.restored.mockResolvedValue(null); state.configuration = targetConfiguration; state.identity.mockResolvedValue({ userId: "owner-test", email: "owner@example.test" }); vi.stubGlobal("fetch", state.fetch); });

describe("복원 대상의 실행 격리와 관리 진입점", () => {
  it("등록 전에도 소유자의 학습·교재·AI·Google 요청을 막고 외부 호출을 하지 않는다", async () => {
    expect((await session()).status).toBe(423);
    expect((await reconcile(request("https://alter.test"))).status).toBe(423);
    expect((await reconciliation(new Request("https://alter.test/api/restore/reconciliation"))).status).toBe(423);
    expect((await tutor(new Request("https://alter.test/api/tutor"))).status).toBe(423);
    expect((await materials(new Request("https://alter.test/api/materials"))).status).toBe(423);
    expect((await googleConnect(request("https://alter.test"))).status).toBe(423);
    expect((await aiProbe(request("https://alter.test"))).status).toBe(423);
    await expect(authenticateAiOwner()).rejects.toMatchObject({ code: "restore_quarantined", status: 423 });
    noEffects();
  });
  it.each([null, { userId: "other", email: "owner@example.test" }])("미인증·다른 계정의 복원 관리 요청은 저장소에 도달하지 않는다: %j", async (identity) => {
    state.identity.mockResolvedValue(identity); const expected = identity === null ? 401 : 403;
    for (const call of [registerTarget, registerSource, issueChallenge, startRestore, manifestAccess, pageAccess, originalAccess, importAccess, importPageAccess, verificationAccess, verificationPageAccess, verificationOriginalAccess, verificationCompleteAccess, activationAccess]) expect((await call(request("https://alter.test"))).status).toBe(expected);
    noEffects();
  });
  it("복원 관리 요청도 교차 출처에서는 실행되지 않는다", async () => {
    for (const call of [registerTarget, registerSource, issueChallenge, startRestore, manifestAccess, pageAccess, originalAccess, importAccess, importPageAccess, verificationAccess, verificationPageAccess, verificationOriginalAccess, verificationCompleteAccess, activationAccess]) expect((await call(request("https://evil.test"))).status).toBe(403);
    noEffects();
  });
  it("활성 복원의 대조 요청도 교차 출처와 다른 소유자에서 차단된다", async () => {
    state.restored.mockResolvedValue({ learning: "active", externalAuthority: "unverified", runId: backupFixtureId(10), activatedAt: 1 });
    expect((await reconcile(request("https://evil.test"))).status).toBe(403);
    state.identity.mockResolvedValue({ userId: "other", email: "other@example.test" });
    expect((await reconcile(request("https://alter.test"))).status).toBe(403);
    expect((await reconciliation(new Request("https://alter.test/api/restore/reconciliation"))).status).toBe(403);
    noEffects();
  });
  it("원본 역할은 대상 등록을, 대상 역할은 원본 등록을 실행하지 못한다", async () => {
    expect((await registerSource(request("https://alter.test"))).status).toBe(409);
    state.configuration = JSON.stringify({ role: "source" });
    for (const call of [registerTarget, issueChallenge, startRestore, manifestAccess, pageAccess, originalAccess, importAccess, importPageAccess, verificationAccess, verificationPageAccess, verificationOriginalAccess, verificationCompleteAccess, activationAccess]) expect((await call(request("https://alter.test"))).status).toBe(409);
    noEffects();
  });
  it("복원 설정이 없으면 기존 인증은 유지하지만 복원 관리 기능은 실행하지 않는다", async () => {
    state.configuration = undefined;
    expect((await session()).status).toBe(200);
    expect((await registerSource(request("https://alter.test"))).status).toBe(409);
    noEffects();
  });
  it("검증 영수증만으로 열리지 않으며 설정 삭제도 격리를 해제하지 않는다", async () => {
    state.restored.mockResolvedValue({runId: backupFixtureId(10), activatedAt: null, learning: "quarantined", externalAuthority: "unverified"});
    for (const configuration of [targetConfiguration, undefined]) { state.configuration = configuration; expect((await session()).status).toBe(423); }
    state.restored.mockResolvedValue({runId: backupFixtureId(10), activatedAt: 1, learning: "active", externalAuthority: "unverified"});
    state.configuration = targetConfiguration; expect((await session()).status).toBe(200); noEffects();
  });
  it("손상된 복원 설정을 일반 실행 모드로 간주하지 않는다", async () => {
    for (const configuration of ["{", "{}", JSON.stringify({ role: "restore-test" })]) {
      state.configuration = configuration; expect((await session()).status).toBe(503);
      expect((await registerTarget(request("https://alter.test"))).status).toBe(409);
    }
    noEffects();
  });
});
