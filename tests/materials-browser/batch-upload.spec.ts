import { expect, test, type Page, type Route } from "@playwright/test";
import type { MaterialLibrary } from "../../lib/materials/library";
import type { MaterialMetadata } from "../../lib/materials/policy";
import { materialBrowser, emptyMaterialLibrary, materialFixture } from "../fixtures/materials-scenario";
import { checkAccessibility } from "../fixtures/accessibility";

const files = [
  { name: "첫 자료.txt", mimeType: "text/plain", buffer: Buffer.from("첫 원본입니다.") },
  { name: "둘째 자료.txt", mimeType: "text/plain", buffer: Buffer.from("둘째 원본입니다.") },
  { name: "마지막 자료.txt", mimeType: "text/plain", buffer: Buffer.from("마지막 원본입니다.") },
];
type Transfer = Readonly<{ id: string; materialId: string; version: number; state: "reserved" | "stored" | "registered"; metadata: MaterialMetadata }>;
type BatchFixture = Readonly<{ writes: string[]; keys: string[]; library: () => MaterialLibrary }>;

async function batchBrowser(page: Page, intercept: (route: Route, transfer: Transfer | null) => Promise<boolean>): Promise<BatchFixture> {
  let library: MaterialLibrary = emptyMaterialLibrary;
  let transfers: readonly Transfer[] = [];
  const writes: string[] = [];
  const keys: string[] = [];
  await materialBrowser(page, library, async (route): Promise<void> => {
    const request = route.request(); const path: string = new URL(request.url()).pathname;
    if (path === "/api/materials") { await route.fulfill({ json: library }); return; }
    const transfer: Transfer | null = transfers.find((item): boolean => path.includes(item.id)) ?? null;
    if (request.method() !== "GET") writes.push(path);
    if (await intercept(route, transfer)) return;
    if (path === "/api/materials/uploads") {
      const key: string = request.headers()["idempotency-key"];
      keys.push(key);
      const existingIndex: number = keys.slice(0, -1).indexOf(key);
      if (existingIndex !== -1) { await route.fulfill({ json: transfers[existingIndex] }); return; }
      expect(library.pending).toHaveLength(0);
      expect(transfers.every((item): boolean => item.state === "registered")).toBe(true);
      const card = materialFixture(100 + transfers.length);
      const id: string = materialFixture(200 + transfers.length).id;
      const metadata: MaterialMetadata = request.postDataJSON().metadata;
      const started: Transfer = { id, materialId: card.id, version: 1, state: "reserved", metadata };
      transfers = [...transfers, started];
      library = { ...library, pending: [started] };
      await route.fulfill({ json: started }); return;
    }
    if (transfer === null) throw new Error("알 수 없는 검증 요청: " + path);
    if (path.endsWith("/body")) {
      expect(request.postDataBuffer()).toEqual(files.find((file): boolean => file.name === transfer.metadata.filename)?.buffer);
      const stored: Transfer = { ...transfer, version: 2, state: "stored" };
      transfers = transfers.map((item): Transfer => item.id === stored.id ? stored : item);
      library = { ...library, pending: [stored] }; await route.fulfill({ json: stored }); return;
    }
    if (path.endsWith("/complete") || path.endsWith("/recover")) {
      expect(transfer.state).toBe("stored");
      const registered: Transfer = { ...transfer, version: 3, state: "registered" };
      transfers = transfers.map((item): Transfer => item.id === registered.id ? registered : item);
      const card = materialFixture(100 + transfers.findIndex((item): boolean => item.id === transfer.id));
      library = { ...library, pending: [], materials: [...library.materials, { ...card, metadata: transfer.metadata, file: { ...card.file, bytes: transfer.metadata.bytes, sha256: transfer.metadata.sha256 } }] };
      await route.fulfill({ json: { ...registered, pages: 1, nextAction: "registered" } }); return;
    }
    throw new Error("승인하지 않은 검증 요청: " + path);
  });
  return { writes, keys, library: (): MaterialLibrary => library };
}

async function chooseBatch(page: Page): Promise<void> {
  const picker = page.getByLabel("원본 파일", { exact: true });
  await expect(picker).toHaveAttribute("multiple", "");
  await picker.setInputFiles(files);
  await expect(page.getByRole("list", { name: "선택한 파일", exact: true }).getByRole("listitem")).toHaveCount(3);
  await expect(page.getByLabel("자료 제목", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
}

test("복수 선택은 각각의 제목과 고유 요청으로 순차 등록하며 원본 3개를 모두 남긴다", async ({ page }, info) => {
  const fixture: BatchFixture = await batchBrowser(page, async (): Promise<boolean> => false);
  await chooseBatch(page);
  const queue = page.getByRole("region", { name: "파일별 등록 상태", exact: true });
  await expect(queue).toContainText("3개 중 3개 등록 완료");
  await expect(page.locator(".alter-material-row")).toHaveCount(3);
  expect(fixture.library().materials.map((item): string => item.metadata.title)).toEqual(files.map((file): string => file.name));
  expect(new Set(fixture.keys).size).toBe(3);
  expect(fixture.writes.map((path): string => path.endsWith("/body") ? "body" : path.endsWith("/complete") ? "complete" : "reserve")).toEqual(["reserve", "body", "complete", "reserve", "body", "complete", "reserve", "body", "complete"]);
  await expect(page.getByRole("button", { name: "자료 등록하기", exact: true })).toBeDisabled();
  await expect(page.getByLabel("원본 파일", { exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "선택 목록 비우기", exact: true }).click();
  await expect(queue).toHaveCount(0);
  await expect(page.locator(".alter-material-row")).toHaveCount(3);
  await checkAccessibility(page, ".material-library", info);
});

test("둘째 자료 등록 응답 유실 시 셋째는 멈추며 복구 후 완료 파일을 다시 전송하지 않는다", async ({ page }) => {
  let interrupted: boolean = false;
  const fixture: BatchFixture = await batchBrowser(page, async (route, transfer): Promise<boolean> => {
    if (!interrupted && transfer?.metadata.filename === files[1].name && route.request().url().endsWith("/complete")) { interrupted = true; await route.abort("failed"); return true; }
    return false;
  });
  await chooseBatch(page);
  const queue = page.getByRole("region", { name: "파일별 등록 상태", exact: true });
  await expect(queue).toContainText("3개 중 1개 등록 완료");
  await expect(queue.locator('[data-upload-state="attention"]')).toHaveCount(1);
  await expect(queue.locator('[data-upload-state="waiting"]')).toHaveCount(1);
  expect(fixture.keys).toHaveLength(2);
  await expect(page.getByRole("button", { name: "자료 등록하기", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "상태 확인·이어서 등록", exact: true }).click();
  await expect(queue).toContainText("3개 중 2개 등록 완료");
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(queue).toContainText("3개 중 3개 등록 완료");
  await expect(page.locator(".alter-material-row")).toHaveCount(3);
  expect(fixture.keys).toHaveLength(3);
  expect(fixture.writes.filter((path): boolean => path.endsWith("/body"))).toHaveLength(3);
});

test("예약 응답 자체가 유실돼도 같은 요청 키로 재조회하며 다른 파일의 키와 섞이지 않는다", async ({ page }) => {
  let failures: number = 0;
  const attempted: string[] = [];
  const fixture: BatchFixture = await batchBrowser(page, async (route, transfer): Promise<boolean> => {
    if (transfer === null && new URL(route.request().url()).pathname === "/api/materials/uploads") {
      attempted.push(route.request().headers()["idempotency-key"]);
      if (failures === 0) { failures += 1; await route.abort("failed"); return true; }
    }
    return false;
  });
  await chooseBatch(page);
  const queue = page.getByRole("region", { name: "파일별 등록 상태", exact: true });
  await expect(queue.locator('[data-upload-state="attention"]')).toHaveCount(1);
  expect(attempted).toHaveLength(1);
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(queue).toContainText("3개 중 3개 등록 완료");
  expect(attempted[0]).toBe(attempted[1]);
  expect(new Set(attempted).size).toBe(3);
  expect(fixture.library().materials).toHaveLength(3);
});

test("다중 선택 중 지원하지 않는 파일은 서버 예약 전에 전체를 멈추고 선택을 수정할 수 있다", async ({ page }) => {
  const fixture: BatchFixture = await batchBrowser(page, async (): Promise<boolean> => false);
  await page.getByLabel("원본 파일", { exact: true }).setInputFiles([files[0], { name: "미지원.heic", mimeType: "image/heic", buffer: Buffer.from("HEIC") }]);
  await page.getByRole("button", { name: "자료 등록하기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("미지원.heic");
  await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "invalid");
  await expect(page.getByRole("link", { name: "다시 로그인", exact: true })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  await expect(page.getByLabel("원본 파일", { exact: true })).toBeEnabled();
  await chooseBatch(page);
  await expect(page.getByRole("region", { name: "파일별 등록 상태", exact: true })).toContainText("3개 중 3개 등록 완료");
});

test("다중 전송 중단 시 다음 파일을 예약하거나 완료를 추정하지 않는다", async ({ page }) => {
  let release: (() => void) | null = null;
  const held: Promise<void> = new Promise((resolve): void => { release = resolve; });
  const fixture: BatchFixture = await batchBrowser(page, async (route, transfer): Promise<boolean> => {
    if (transfer !== null && route.request().url().endsWith("/body")) { await held; await route.abort("failed"); return true; }
    return false;
  });
  await chooseBatch(page);
  await expect(page.locator(".alter-upload-progress")).toHaveAttribute("data-phase", "transferring");
  await page.getByRole("button", { name: "전송 중단", exact: true }).click();
  await expect(page.locator('[data-upload-issue="interrupted"]')).toBeVisible();
  await expect(page.locator('[data-upload-state="waiting"]')).toHaveCount(2);
  expect(fixture.keys).toHaveLength(1);
  expect(fixture.library().materials).toHaveLength(0);
  if (release === null) throw new Error("중단 검증 응답 제어가 없습니다.");
  (release as () => void)();
});
