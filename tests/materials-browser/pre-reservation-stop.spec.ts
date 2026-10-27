import { expect, test, type Page } from "@playwright/test";
import { materialBrowser, emptyMaterialLibrary } from "../fixtures/materials-scenario";

const originalFile = { name: "선택 원본.txt", mimeType: "text/plain", buffer: Buffer.from("서버 전송 전 시험 원본입니다.") };
const replacementFile = { name: "다른 원본.txt", mimeType: "text/plain", buffer: Buffer.from("다시 선택한 시험 원본입니다.") };

async function selectOriginal(page: Page): Promise<void> {
  await page.getByLabel("자료 제목", { exact: true }).fill("보존할 제목");
  await page.getByLabel("판본 (선택)", { exact: true }).fill("보존할 판본");
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles(originalFile);
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
}

async function changeUnreservedSelection(page: Page): Promise<void> {
  await expect(page.getByRole("button", { name: "선택 목록 비우기", exact: true })).toBeEnabled();
  await expect(page.locator('[data-upload-state="waiting"]')).toHaveCount(1);
  await expect(page.locator("[data-upload-issue]")).toHaveCount(0);
  await page.getByRole("button", { name: "선택 목록 비우기", exact: true }).click();
  await expect(page.getByLabel("원본 파일", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("자료 제목", { exact: true })).toBeEnabled();
  await expect(page.getByLabel("자료 제목", { exact: true })).toHaveValue("보존할 제목");
  await expect(page.getByLabel("판본 (선택)", { exact: true })).toHaveValue("보존할 판본");
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles(replacementFile);
  await expect(page.getByRole("list", { name: "선택한 파일", exact: true })).toHaveText("다른 원본.txt");
}

test("첫 해시 검사 중 취소하면 예약 없이 선택을 비우고 원본을 바꿀 수 있다", async ({ page }) => {
  const writes: string[] = [];
  await page.addInitScript((): void => {
    const original: (this: File) => Promise<ArrayBuffer> = File.prototype.arrayBuffer;
    File.prototype.arrayBuffer = function (this: File): Promise<ArrayBuffer> {
      document.documentElement.dataset.fileReadPending = "true";
      return new Promise<ArrayBuffer>((resolve, reject): void => {
        window.addEventListener("alter-test-release-file", (): void => { void original.call(this).then(resolve, reject); }, { once: true });
      });
    };
  });
  await materialBrowser(page, emptyMaterialLibrary, async (route): Promise<void> => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    await route.fulfill({ json: emptyMaterialLibrary });
  });
  await selectOriginal(page);
  await expect(page.locator("html")).toHaveAttribute("data-file-read-pending", "true");
  await page.getByRole("button", { name: "전송 중단", exact: true }).click();
  await page.evaluate((): void => { window.dispatchEvent(new Event("alter-test-release-file")); });
  await changeUnreservedSelection(page);
  expect(writes).toEqual([]);
});

test("원본 읽기 실패는 예약 없이 선택을 바꿀 수 있고 실패 원인을 알린다", async ({ page }) => {
  const writes: string[] = [];
  await page.addInitScript((): void => {
    File.prototype.arrayBuffer = function (): Promise<ArrayBuffer> {
      return Promise.reject(new DOMException("시험 원본을 읽을 수 없어요.", "NotReadableError"));
    };
  });
  await materialBrowser(page, emptyMaterialLibrary, async (route): Promise<void> => {
    if (route.request().method() !== "GET") writes.push(route.request().url());
    await route.fulfill({ json: emptyMaterialLibrary });
  });
  await selectOriginal(page);
  await expect(page.locator(".material-feedback").getByRole("alert")).toContainText("시험 원본을 읽을 수 없어요.");
  await changeUnreservedSelection(page);
  expect(writes).toEqual([]);
});

test("예약 응답 유실 후 재시도 해시를 취소해도 불명인 기존 요청의 선택은 잠근다", async ({ page }) => {
  const writes: string[] = [];
  await page.addInitScript((): void => {
    const original: (this: File) => Promise<ArrayBuffer> = File.prototype.arrayBuffer;
    let reads: number = 0;
    File.prototype.arrayBuffer = function (this: File): Promise<ArrayBuffer> {
      reads += 1;
      if (reads === 1) return original.call(this);
      document.documentElement.dataset.fileReadPending = "true";
      return new Promise<ArrayBuffer>((resolve, reject): void => {
        window.addEventListener("alter-test-release-file", (): void => { void original.call(this).then(resolve, reject); }, { once: true });
      });
    };
  });
  await materialBrowser(page, emptyMaterialLibrary, async (route): Promise<void> => {
    if (route.request().method() === "GET") { await route.fulfill({ json: emptyMaterialLibrary }); return; }
    writes.push(route.request().url());
    await route.abort("failed");
  });
  await selectOriginal(page);
  await expect(page.locator('[data-upload-state="attention"]')).toHaveCount(1);
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-file-read-pending", "true");
  await page.getByRole("button", { name: "전송 중단", exact: true }).click();
  await page.evaluate((): void => { window.dispatchEvent(new Event("alter-test-release-file")); });
  await expect(page.locator('[data-upload-issue="interrupted"]')).toBeVisible();
  await expect(page.locator('[data-upload-state="attention"]')).toHaveCount(1);
  await expect(page.getByRole("button", { name: "선택 목록 비우기", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("원본 파일", { exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
});
