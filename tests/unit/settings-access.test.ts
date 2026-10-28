import { beforeEach, describe, expect, it, vi } from "vitest";
import MorePage from "../../app/learn/more/page";
import DiagnosticsPage from "../../app/learn/diagnostics/page";

const access = vi.hoisted(() => ({ read: vi.fn<() => Promise<Readonly<{ rejection: Response | null }>>>() }));
vi.mock("cloudflare:workers", () => ({ env: {} }));
vi.mock("@/lib/materials/server-access", () => ({ materialOwnerAccess: access.read }));
vi.mock("../../app/chatgpt-auth", () => ({ chatGPTSignOutPath: (path: string): string => `/signout-with-chatgpt?return_to=${encodeURIComponent(path)}` }));
vi.mock("next/navigation", () => ({ unauthorized: (): never => { throw new Error("unauthorized"); }, forbidden: (): never => { throw new Error("forbidden"); } }));

for (const Page of [MorePage, DiagnosticsPage]) describe(`설정·진단 서버 접근: ${Page.name}`, () => {
  beforeEach((): void => { access.read.mockReset(); });
  it.each([401, 403])("HTTP %i에서 관리 메뉴를 렌더링하지 않음", async (status): Promise<void> => {
    access.read.mockResolvedValue({ rejection: new Response(null, { status }) });
    await expect(Page()).rejects.toThrow(status === 401 ? "unauthorized" : "forbidden");
  });
  it("소유자 허용 뒤에만 설정 본문을 반환", async (): Promise<void> => {
    access.read.mockResolvedValue({ rejection: null }); const page = await Page();
    expect(page.type).toBe("main"); expect(page.props).toMatchObject({ id: "learn-main" }); expect(access.read).toHaveBeenCalledTimes(1);
  });
});
