import { expect, test, type Page } from "@playwright/test";
import { mountGoogleConnection } from "../fixtures/google-ui-browser";
import { checkAccessibility } from "../fixtures/accessibility";

type PickerRequest = Readonly<{ path: string; body: unknown }>;
async function mockPicker(page: Page, mode: "normal" | "expired" | "wrong-generation" | "wrong-role", requests: PickerRequest[]): Promise<void> {
  await page.route("https://google.connection.test/api/google/**", async (route): Promise<void> => {
    const path: string = new URL(route.request().url()).pathname; const body: unknown = route.request().postDataJSON(); requests.push({ path, body });
    if (path === "/api/google/storage") { await route.fulfill({ json: { status: "verified" } }); return; }
    if (path === "/api/google/picker") {
      await route.fulfill({ json: { leaseId: "00000000-0000-4000-8000-000000002002", connectionId: "00000000-0000-4000-8000-000000002001", generation: mode === "wrong-generation" ? 3 : 4, projectNumber: "123456789", origin: "https://google.connection.test", apiKey: "fixture-picker-key-not-real", accessToken: "fixture-access-token-not-real", tokenExpiresAt: Date.now() + 120000, leaseExpiresAt: mode === "expired" ? Date.now() - 1000 : Date.now() + 60000 } }); return;
    }
    if (path === "/api/google/picker/cancel") { await route.fulfill({ json: { canceled: true } }); return; }
    if (path === "/api/google/picker/select") { const selected = body as Readonly<{ role: string }>; await route.fulfill({ json: { name: "서버가 검증한 시험 파일", role: mode === "wrong-role" ? "sheets-target" : selected.role } }); return; }
    throw new Error(`시험 Picker 범위 밖 요청: ${path}`);
  });
}

for (const role of ["reference", "docs-target", "sheets-target"] as const) test(`Picker ${role}의 사용자 선택 ID만 등록하고 내용 전송과 구분`, async ({ page }, info): Promise<void> => {
  const requests: PickerRequest[] = []; await mountGoogleConnection(page, "active", true, null); await mockPicker(page, "normal", requests);
  await page.getByRole("button", { name: "Google 저장 용량 확인", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Google 저장 용량을 확인했어요");
  await page.getByRole("combobox", { name: "파일 용도", exact: true }).selectOption(role);
  await page.getByRole("button", { name: "Google에서 파일 선택", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Google 시험 파일 선택", exact: true }); await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "시험 파일 선택 완료", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const result = page.getByRole("region", { name: "마지막으로 확인한 파일 선택", exact: true });
  await expect(result).toContainText("서버가 검증한 시험 파일");
  await expect(result).not.toContainText("신뢰하지 않는 선택기 이름");
  expect(requests.map(request => request.path)).toEqual(["/api/google/storage", "/api/google/picker", "/api/google/picker/select"]);
  expect(requests[2].body).toEqual({ leaseId: "00000000-0000-4000-8000-000000002002", connectionId: "00000000-0000-4000-8000-000000002001", generation: 4, fileId: "fixture-selected-doc", role });
  await expect(result.getByRole("link")).toHaveAttribute("href", role === "reference" ? "/learn/google/references" : "/learn/weekly");
  await expect(page.locator("body")).not.toContainText("fixture-access-token-not-real");
  await checkAccessibility(page, ".google-file-selection", info);
});

test("Picker 취소는 선택 등록 없이 같은 선택 시도를 종료", async ({ page }): Promise<void> => {
  const requests: PickerRequest[] = []; await mountGoogleConnection(page, "active", true, null); await mockPicker(page, "normal", requests);
  await page.getByRole("button", { name: "Google에서 파일 선택", exact: true }).click();
  await page.getByRole("button", { name: "시험 파일 선택 취소", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("파일 선택을 취소했어요.");
  expect(requests.map(request => request.path)).toEqual(["/api/google/picker", "/api/google/picker/cancel"]);
  expect(requests[1].body).toEqual({ leaseId: "00000000-0000-4000-8000-000000002002" });
  await expect(page.getByRole("region", { name: "마지막으로 확인한 파일 선택", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Google에서 파일 선택", exact: true })).toBeEnabled();
});

for (const mode of ["expired", "wrong-generation"] as const) test(`Picker ${mode} 인증은 선택기를 열거나 파일을 등록하지 못함`, async ({ page }): Promise<void> => {
  const requests: PickerRequest[] = []; await mountGoogleConnection(page, "active", true, null); await mockPicker(page, mode, requests);
  await page.getByRole("button", { name: "Google에서 파일 선택", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(mode === "expired" ? "만료" : "현재 연결 계정·상태와 다릅니다");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(requests.map(request => request.path)).toEqual(["/api/google/picker"]);
  await expect(page.getByRole("button", { name: "Google에서 파일 선택", exact: true })).toBeEnabled();
});

test("다른 용도의 등록 응답은 파일 선택 완료로 표시하지 않음", async ({ page }): Promise<void> => {
  const requests: PickerRequest[] = []; await mountGoogleConnection(page, "active", true, null); await mockPicker(page, "wrong-role", requests);
  await page.getByRole("button", { name: "Google에서 파일 선택", exact: true }).click();
  await page.getByRole("button", { name: "시험 파일 선택 완료", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("선택한 용도와 달라요");
  await expect(page.getByRole("region", { name: "마지막으로 확인한 파일 선택", exact: true })).toHaveCount(0);
});
