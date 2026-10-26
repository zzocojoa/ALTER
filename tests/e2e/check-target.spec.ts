import { expect, test } from "@playwright/test";
import { checkAccessibility } from "../fixtures/accessibility";
import { libraryReply } from "../../app/learn/materials/client-api";

test("확인 링크가 비동기 학습·결제 영역을 열고 초점과 위치를 맞춘다", async ({ page }, info) => {
  const hydrationErrors: string[] = [];
  page.on("console", message => { if (/hydration|hydrated/i.test(message.text())) hydrationErrors.push(message.text()); });
  await page.goto("/signin-with-chatgpt?return_to=/learn");
  for (const id of ["check-progress", "check-budget"]) {
    await page.goto(`/learn#${id}`);
    const target = page.locator(`#${id}`);
    await expect(target).toBeFocused();
    await expect(target.getByText("지금 확인할 곳", { exact: true })).toBeInViewport();
    await expect.poll(async () => (await target.boundingBox())?.y).toBeLessThan(80);
    if (id === "check-budget") await expect(page.locator(".usage-disclosure")).toHaveAttribute("open", "");
    await checkAccessibility(page, `#${id}`, info);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `outputs/${id}-${info.project.name}.png` });
  }
  expect(hydrationErrors).toEqual([]); expect(await page.pageErrors()).toEqual([]);
});

test("기존 PDF 직접 링크가 긴 등록 목록을 건너뛰고 확대 버튼을 보여준다", async ({ page }, info) => {
  await page.goto("/signin-with-chatgpt?return_to=/learn/materials");
  const response = await page.request.get("/api/materials"); expect(response.ok()).toBe(true);
  const library = libraryReply.parse(await response.json());
  const pdf = library.materials.find(item => item.metadata.kind === "pdf");
  if (!pdf) throw new Error("실제 로컬 D1/R2의 등록된 PDF 검증 자료가 필요합니다.");
  await page.goto(`/learn/materials?open=${pdf.id}#check-original`);
  const target = page.locator("#check-original");
  await expect(target).toBeFocused();
  const expand = target.getByRole("button", { name: "파일 1페이지 원본 크게 보기", exact: true });
  await expect(expand).toBeInViewport();
  await expand.click();
  const dialog = page.getByRole("dialog", { name: "파일 1페이지 원본", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("slider")).toBeVisible();
  await dialog.getByRole("button", { name: "확대 화면 닫기" }).click();
  await expect(expand).toBeFocused();
  await checkAccessibility(page, "#check-original", info);
  await page.reload(); await expect(page.locator(".material-library")).not.toHaveAttribute("inert"); await expect(target).toBeFocused(); await expect(expand).toBeInViewport();
  await page.screenshot({ path: `outputs/check-original-${info.project.name}.png` });
  expect(await page.pageErrors()).toEqual([]);
});
