import { expect, test } from "@playwright/test";
import { mountEditorInput } from "../fixtures/editor-input-browser";
import { editorSubmittedFixture } from "../fixtures/editor-state";
import { publicEditorView } from "../../lib/editor/view";

for (const status of [401, 403, 503]) test(`비JSON HTTP ${status} 응답도 권한 상태를 보존하고 새 조회로만 복구`, async ({ page }) => {
  const state = editorSubmittedFixture();
  await mountEditorInput(page, state);
  await page.route("**/api/editor*", async (route): Promise<void> => { await route.fulfill({ status, contentType: "text/html", body: status === 401 ? "" : "<html>upstream access failed</html>" }); });
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  if (status === 401 || status === 403) {
    await expect(page.getByRole("region", { name: "결과물 개선", exact: true })).toHaveCount(0);
    expect(await page.locator(".editor-workspace").innerHTML()).not.toContain(state.editor!.versions[0].text);
  } else await expect(page.getByRole("region", { name: "결과물 개선", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").first()).toContainText(`HTTP ${status}`);
  await page.route("**/api/editor*", async (route): Promise<void> => { await route.fulfill({ json: publicEditorView(state) }); });
  await page.getByRole("button", { name: "최신 개선 기록 확인", exact: true }).click();
  await expect(page.getByRole("region", { name: "결과물 개선", exact: true })).toBeVisible();
});
