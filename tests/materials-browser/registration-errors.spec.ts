import { expect, test } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary } from "../fixtures/materials-scenario";
import { checkAccessibility } from "../fixtures/accessibility";

test("빈 텍스트는 전송 전 입력 오류로 알리고 로그인이나 저장 결과 확인을 요구하지 않는다", async ({ page }, info) => {
  const requests: string[] = [];
  await materialBrowser(page, emptyMaterialLibrary, async (route): Promise<void> => {
    requests.push(route.request().method() + " " + new URL(route.request().url()).pathname);
    await route.fulfill({ json: emptyMaterialLibrary });
  });
  await page.getByLabel("자료 제목", { exact: true }).fill("VoiceOver 오류 확인");
  await page.locator("#material-input-kind").selectOption("text");
  const before: number = requests.length;
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("등록할 텍스트를 붙여 넣어 주세요.");
  await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "invalid");
  await expect(page.locator(".alter-upload-progress")).toContainText("원본 전송은 시작하지 않았어요");
  await expect(page.getByRole("link", { name: "다시 로그인", exact: true })).toHaveCount(0);
  await expect(page.getByText("등록 완료를 확인하지 못했어요.", { exact: false })).toHaveCount(0);
  await expect(page.getByLabel("자료 제목", { exact: true })).toHaveValue("VoiceOver 오류 확인");
  await expect(page.getByLabel("텍스트 원본", { exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "자료 등록하기", exact: true })).toBeFocused();
  expect(requests.slice(before)).toEqual([]);
  await checkAccessibility(page, ".material-library", info);
});

for (const status of [401, 403, 503]) {
  test(`서버 ${status} 응답은 입력 오류와 구분하고 401에만 로그인 복귀를 제공한다`, async ({ page }) => {
    const writes: string[] = [];
    await materialBrowser(page, emptyMaterialLibrary, async (route): Promise<void> => {
      const request = route.request();
      const path: string = new URL(request.url()).pathname;
      if (path === "/api/materials") { await route.fulfill({ json: emptyMaterialLibrary }); return; }
      expect(path).toBe("/api/materials/uploads");
      writes.push(request.method() + " " + path);
      await route.fulfill({ status, json: { error: status === 401 ? "authentication_required" : status === 403 ? "access_denied" : "result_unknown" } });
    });
    await page.getByLabel("자료 제목", { exact: true }).fill("서버 실패 확인");
    await page.locator("#material-input-kind").selectOption("text");
    await page.getByLabel("텍스트 원본", { exact: true }).fill("보존할 시험 원본입니다.");
    await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
    await expect(page.locator(".material-feedback").getByRole("alert")).toContainText(String(status));
    await expect(page.getByRole("link", { name: "다시 로그인", exact: true })).toHaveCount(status === 401 ? 1 : 0);
    await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "attention");
    await expect(page.getByLabel("텍스트 원본", { exact: true })).toHaveValue("보존할 시험 원본입니다.");
    expect(writes).toEqual(["POST /api/materials/uploads"]);
  });
}
