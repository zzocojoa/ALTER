import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OwnerDecision } from "../../lib/auth-policy";
import OwnerSetup from "../../app/setup/page";
import RestorePage from "../../app/restore/page";
import Forbidden from "../../app/forbidden";
import Unauthorized from "../../app/unauthorized";
import PageError from "../../app/error";
import NotFound from "../../app/not-found";
import { RestoreAccessBoundary } from "../../app/restore/restore-access-boundary";

const state = vi.hoisted(() => ({ owner: undefined as string | undefined, expires: undefined as string | undefined, restore: undefined as string | undefined, user: vi.fn<() => Promise<null | { userId: string }>>(), access: vi.fn<() => Promise<OwnerDecision>>() }));
vi.mock("cloudflare:workers", () => ({ env: { get ALTER_OWNER_USER_ID() { return state.owner; }, get ALTER_OWNER_ENROLLMENT_EXPIRES_AT() { return state.expires; }, get ALTER_RESTORE_CONFIGURATION() { return state.restore; } } }));
vi.mock("../../app/chatgpt-auth", () => ({ getChatGPTUser: state.user, chatGPTSignInPath: (path: string): string => `/signin-with-chatgpt?return_to=${encodeURIComponent(path)}`, chatGPTSignOutPath: (path: string): string => `/signout-with-chatgpt?return_to=${encodeURIComponent(path)}` }));
vi.mock("../../lib/owner-access", () => ({ getAuthenticatedOwnerDecision: state.access }));
vi.mock("next/navigation", () => ({ unauthorized: (): never => { throw new Error("unauthorized"); }, forbidden: (): never => { throw new Error("forbidden"); } }));

beforeEach(() => { vi.clearAllMocks(); state.owner = undefined; state.expires = undefined; state.restore = undefined; state.user.mockResolvedValue(null); state.access.mockResolvedValue({ kind: "owner" }); });
describe("설정·복원 관리 화면의 서버 분기", () => {
  it("등록 기간이 없거나 소유자가 있으면 후보 요청과 계정 조회를 열지 않는다", async () => { for (const owner of [undefined, "owner-test"]) { state.owner = owner; expect(renderToStaticMarkup(await OwnerSetup())).toContain("소유자 확인이 닫혀 있어요"); } expect(state.user).not.toHaveBeenCalled(); });
  it("유효 기간의 미인증 사용자는 setup으로 안전하게 복귀한다", async () => { state.expires = new Date(Date.now() + 60000).toISOString(); const html: string = renderToStaticMarkup(await OwnerSetup()); expect(html).toContain("return_to=%2Fsetup"); expect(html).not.toContain("/api/setup/candidate"); });
  it("후보 요청은 기존 POST에 연결하되 권한을 부여하거나 계정 ID를 노출하지 않는다", async () => { state.expires = new Date(Date.now() + 60000).toISOString(); state.user.mockResolvedValue({ userId: "private-owner-fixture" }); const html: string = renderToStaticMarkup(await OwnerSetup()); expect(html).toContain('action="/api/setup/candidate"'); expect(html).toContain('method="post"'); expect(html).not.toContain("private-owner-fixture"); });
  it.each(["unauthenticated", "forbidden"] as const)("복원 관리의 %s는 본문을 렌더링하지 않는다", async kind => { state.access.mockResolvedValue({ kind }); await expect(RestorePage()).rejects.toThrow(kind === "unauthenticated" ? "unauthorized" : "forbidden"); });
  it("복원 설정 누락은 설정 미완료로 표시하고 임의 대상을 만들지 않는다", async () => { const html: string = renderToStaticMarkup(await RestorePage()); expect(html).toContain("복원 관리자 설정이 아직 없습니다"); expect(html).not.toContain("복원 작업 ID"); });
  it("확인된 원본 역할만 복원 관리 재확인 경계 안에 렌더링한다", async () => { state.restore = JSON.stringify({ role: "source" }); const page = await RestorePage(); expect(page.type).toBe(RestoreAccessBoundary); });
});
describe("공개 접근·오류 화면", () => {
  it("로그인·로그아웃은 기존 안전한 복귀 경로를 유지한다", () => { expect(renderToStaticMarkup(createElement(Unauthorized))).toContain("return_to=%2Flearn"); expect(renderToStaticMarkup(createElement(Forbidden))).toContain("return_to=%2F"); });
  it("원문 오류와 digest는 표시하지 않으며 없는 경로에도 복귀 링크가 있다", () => { const error = Object.assign(new Error("secret-fixture-signed-url"), { digest: "private-session-fixture" }); const html: string = renderToStaticMarkup(createElement(PageError, { error, reset: (): void => {} })); expect(html).not.toMatch(/secret-fixture|private-session-fixture/); expect(html).toContain("화면 다시 열기"); expect(renderToStaticMarkup(createElement(NotFound))).toContain('href="/learn"'); });
});
